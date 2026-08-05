import { prisma } from '../../database/connection';
import { asLogger } from '../../shared/utils/asLogger';
import { config } from '../../shared/config/app.config';
import { AgendaManager } from '../../agenda';
import { SocketService } from '../../shared/socket/socket.service';
import { SocketEvents } from '../../shared/socket/socket.events';
import {
    NotificationType,
    NOTIFICATION_EMAIL_TYPES,
    notificationSelect,
} from './notification.types';

/**
 * The single place a notification is actually delivered.
 *
 * Before this existed, every service queued a `notify-group-members` job whose worker
 * only logged the payload — no row was ever written to `notifications`, which is why
 * the unread counter and the notifications page were always empty. Services now hand
 * a fully-formed notification to the dispatcher and it fans out across the three
 * channels, each independently opt-out-able via `notification_preferences`:
 *
 *   in-app  — a `notifications` row plus a live socket push to `user:{id}`
 *   email   — queued through BullMQ, and only for the low-frequency types in
 *             NOTIFICATION_EMAIL_TYPES (never per chat message)
 *   push    — queued for FCM (worker still a stub)
 */

export interface NotificationEmail {
    subject: string;
    template: string;
    /** Merged with `displayName` and `clientUrl`, which the dispatcher always supplies. */
    data?: Record<string, unknown>;
}

export interface DispatchInput {
    userIds: string[];
    type: NotificationType;
    title: string;
    body?: string;
    referenceType?: string;
    referenceId?: string;
    /** Scopes the preference lookup — a per-group mute beats the account-wide default. */
    groupId?: string;
    email?: NotificationEmail;
}

interface ChannelPrefs {
    inApp: boolean;
    email: boolean;
    push: boolean;
}

const DEFAULT_PREFS: ChannelPrefs = { inApp: true, email: true, push: true };

export class NotificationDispatcher {
    /**
     * Delivers one notification to many recipients. Never throws: a notification failing
     * must not roll back the action that triggered it (an event still exists even if the
     * announcement email bounces). Failures are logged instead.
     */
    static async dispatch(input: DispatchInput): Promise<void> {
        const userIds = [...new Set(input.userIds)].filter(Boolean);
        if (userIds.length === 0) return;

        try {
            const prefs = await NotificationDispatcher.resolvePreferences(
                userIds,
                input.type,
                input.groupId,
            );

            const inAppRecipients = userIds.filter((id) => prefs.get(id)!.inApp);
            const pushRecipients = userIds.filter((id) => prefs.get(id)!.push);
            const emailRecipients = NOTIFICATION_EMAIL_TYPES.includes(input.type) && input.email
                ? userIds.filter((id) => prefs.get(id)!.email)
                : [];

            await Promise.all([
                NotificationDispatcher.deliverInApp(inAppRecipients, input),
                NotificationDispatcher.deliverEmail(emailRecipients, input),
                NotificationDispatcher.deliverPush(pushRecipients, input),
            ]);
        } catch (error) {
            asLogger.error('NotificationDispatcher.dispatch failed', {
                type: input.type,
                recipients: userIds.length,
                error,
            });
        }
    }

    /**
     * Fans out to every active member of a group. `excludeUserIds` keeps the actor from
     * being notified about their own action.
     */
    static async dispatchToGroup(
        groupId: string,
        input: Omit<DispatchInput, 'userIds' | 'groupId'>,
        options: { excludeUserIds?: string[]; roles?: string[] } = {},
    ): Promise<void> {
        try {
            const members = await prisma.membership.findMany({
                where: {
                    groupId,
                    status: 'active',
                    ...(options.roles ? { role: { in: options.roles } } : {}),
                    ...(options.excludeUserIds?.length
                        ? { userId: { notIn: options.excludeUserIds } }
                        : {}),
                },
                select: { userId: true },
            });

            await NotificationDispatcher.dispatch({
                ...input,
                groupId,
                userIds: members.map((m) => m.userId),
            });
        } catch (error) {
            asLogger.error('NotificationDispatcher.dispatchToGroup failed', { groupId, error });
        }
    }

    // ── Channels ──────────────────────────────────────────────────────────────

    private static async deliverInApp(userIds: string[], input: DispatchInput): Promise<void> {
        if (userIds.length === 0) return;

        // createMany does not return rows, and the socket push needs the created ids so a
        // client can mark one read straight from the toast. The recipient set is bounded by
        // group size, so a createMany + re-read is cheaper than N creates.
        const createdAt = new Date();
        await prisma.notification.createMany({
            data: userIds.map((userId) => ({
                userId,
                type: input.type,
                title: input.title,
                body: input.body ?? null,
                referenceType: input.referenceType ?? null,
                referenceId: input.referenceId ?? null,
                createdAt,
            })),
        });

        if (!SocketService.isReady) return;

        const created = await prisma.notification.findMany({
            where: { userId: { in: userIds }, type: input.type, createdAt },
            select: notificationSelect,
        });

        for (const notification of created) {
            SocketService.emitToRoom(
                `user:${notification.userId}`,
                SocketEvents.NOTIFICATION_CREATED,
                { notification },
            );
        }
    }

    private static async deliverEmail(userIds: string[], input: DispatchInput): Promise<void> {
        if (userIds.length === 0 || !input.email) return;

        const users = await prisma.user.findMany({
            where: { id: { in: userIds }, deletedAt: null, status: 'active' },
            select: { email: true, displayName: true },
        });

        await Promise.all(
            users.map((user) =>
                AgendaManager.sendEmail({
                    to: user.email,
                    subject: input.email!.subject,
                    template: input.email!.template,
                    data: {
                        displayName: user.displayName,
                        clientUrl: config.server.clientUrl,
                        ...input.email!.data,
                    },
                }),
            ),
        );
    }

    private static async deliverPush(userIds: string[], input: DispatchInput): Promise<void> {
        if (userIds.length === 0) return;

        await AgendaManager.runNow('send-push-notification', {
            userIds,
            type: input.type,
            title: input.title,
            body: input.body ?? null,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
        });
    }

    // ── Preference resolution ─────────────────────────────────────────────────

    /**
     * Most specific preference wins: a row scoped to this group, else the account-wide
     * row (group_id IS NULL), else the defaults. Resolved for the whole recipient set in
     * one query so a 500-member group is still two round-trips.
     */
    private static async resolvePreferences(
        userIds: string[],
        type: NotificationType,
        groupId?: string,
    ): Promise<Map<string, ChannelPrefs>> {
        const rows = await prisma.notificationPreference.findMany({
            where: {
                userId: { in: userIds },
                prefType: type,
                OR: [{ groupId: null }, ...(groupId ? [{ groupId }] : [])],
            },
            select: {
                userId: true,
                groupId: true,
                inAppEnabled: true,
                emailEnabled: true,
                pushEnabled: true,
            },
        });

        const global = new Map<string, ChannelPrefs>();
        const scoped = new Map<string, ChannelPrefs>();

        for (const row of rows) {
            const target = row.groupId === null ? global : scoped;
            target.set(row.userId, {
                inApp: row.inAppEnabled,
                email: row.emailEnabled,
                push: row.pushEnabled,
            });
        }

        return new Map(
            userIds.map((id) => [id, scoped.get(id) ?? global.get(id) ?? DEFAULT_PREFS]),
        );
    }
}
