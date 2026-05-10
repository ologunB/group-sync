import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../database/connection';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import { asLogger } from '../../shared/utils/asLogger';
import { AuditLogger, LogActions, ResourceTypes } from '../../shared/utils/audit.logger';
import { TokenPayload } from '../../shared/types/common.types';
import {
    ListNotificationsQuery,
    UpdatePreferencesDTO,
    NotificationPublic,
    NotificationPrefPublic,
    notificationSelect,
    notificationPrefSelect,
} from './notification.types';

export class NotificationService {
    // ── List notifications (cursor-based) ─────────────────────────────────────

    async listNotifications(
        query: ListNotificationsQuery,
        actor: TokenPayload,
    ): Promise<{ data: NotificationPublic[]; next_cursor: string | null; has_more: boolean; unread_count: number }> {
        try {
            const limit = Math.min(query.limit ?? 20, 50);
            const where: Record<string, unknown> = { userId: actor.userId };

            if (query.unread_only) where.isRead = false;

            // Cursor: fetch records older than the cursor notification's createdAt
            if (query.cursor) {
                const cursorRow = await prisma.notification.findUnique({
                    where: { id: query.cursor },
                    select: { createdAt: true },
                });
                if (cursorRow) {
                    where.createdAt = { lt: cursorRow.createdAt };
                }
            }

            const [data, unread_count] = await Promise.all([
                prisma.notification.findMany({
                    where: where as any,
                    select: notificationSelect,
                    orderBy: { createdAt: 'desc' },
                    take: limit + 1,
                }),
                prisma.notification.count({ where: { userId: actor.userId, isRead: false } }),
            ]);

            const has_more = data.length > limit;
            if (has_more) data.pop();

            return {
                data,
                next_cursor: has_more ? data[data.length - 1].id : null,
                has_more,
                unread_count,
            };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('NotificationService.listNotifications error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Mark single notification as read ─────────────────────────────────────

    async markRead(notificationId: string, actor: TokenPayload): Promise<NotificationPublic> {
        try {
            const notification = await prisma.notification.findUnique({
                where: { id: notificationId },
                select: { userId: true },
            });

            if (!notification) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Notification'), StatusCodes.NOT_FOUND);
            }

            if (notification.userId !== actor.userId) {
                throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
            }

            const updated = await prisma.notification.update({
                where: { id: notificationId },
                data: { isRead: true },
                select: notificationSelect,
            });

            await AuditLogger.log(actor, LogActions.NOTIFICATION_READ, ResourceTypes.NOTIFICATION, notificationId, 1);

            return updated;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('NotificationService.markRead error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Mark all notifications as read ────────────────────────────────────────

    async markAllRead(actor: TokenPayload): Promise<{ count: number }> {
        try {
            const result = await prisma.notification.updateMany({
                where: { userId: actor.userId, isRead: false },
                data: { isRead: true },
            });

            await AuditLogger.log(actor, LogActions.NOTIFICATION_READ_ALL, ResourceTypes.NOTIFICATION, null, 1, { count: result.count });

            return { count: result.count };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('NotificationService.markAllRead error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Delete notification ───────────────────────────────────────────────────

    async deleteNotification(notificationId: string, actor: TokenPayload): Promise<void> {
        try {
            const notification = await prisma.notification.findUnique({
                where: { id: notificationId },
                select: { userId: true },
            });

            if (!notification) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Notification'), StatusCodes.NOT_FOUND);
            }

            if (notification.userId !== actor.userId) {
                throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
            }

            await prisma.notification.delete({ where: { id: notificationId } });

            await AuditLogger.log(actor, LogActions.NOTIFICATION_DELETE, ResourceTypes.NOTIFICATION, notificationId, 1);
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('NotificationService.deleteNotification error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Get notification preferences ──────────────────────────────────────────

    async getPreferences(actor: TokenPayload): Promise<NotificationPrefPublic[]> {
        try {
            return prisma.notificationPreference.findMany({
                where: { userId: actor.userId },
                select: notificationPrefSelect,
                orderBy: { createdAt: 'asc' },
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('NotificationService.getPreferences error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Update notification preferences ───────────────────────────────────────

    async updatePreferences(dto: UpdatePreferencesDTO, actor: TokenPayload): Promise<NotificationPrefPublic[]> {
        try {
            // Upsert each preference individually — prisma upsert with nullable groupId in composite
            // unique key is unreliable because NULL != NULL in SQL unique constraints.
            for (const pref of dto.preferences) {
                const existing = await prisma.notificationPreference.findFirst({
                    where: { userId: actor.userId, groupId: pref.group_id ?? null, prefType: pref.pref_type },
                    select: { id: true },
                });
                if (existing) {
                    await prisma.notificationPreference.update({
                        where: { id: existing.id },
                        data: { pushEnabled: pref.push_enabled, inAppEnabled: pref.in_app_enabled },
                    });
                } else {
                    await prisma.notificationPreference.create({
                        data: {
                            userId: actor.userId,
                            groupId: pref.group_id ?? null,
                            prefType: pref.pref_type,
                            pushEnabled: pref.push_enabled,
                            inAppEnabled: pref.in_app_enabled,
                        },
                    });
                }
            }

            await AuditLogger.log(actor, LogActions.NOTIFICATION_PREF_UPDATE, ResourceTypes.NOTIFICATION, null, 1);

            return this.getPreferences(actor);
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('NotificationService.updatePreferences error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Static helper: create a notification (used by other services) ─────────

    static async create(data: {
        userId: string;
        type: string;
        title: string;
        body?: string;
        referenceType?: string;
        referenceId?: string;
    }): Promise<void> {
        try {
            await prisma.notification.create({
                data: {
                    userId: data.userId,
                    type: data.type,
                    title: data.title,
                    body: data.body ?? null,
                    referenceType: data.referenceType ?? null,
                    referenceId: data.referenceId ?? null,
                },
            });
        } catch (err) {
            asLogger.error('NotificationService.create error:', err);
        }
    }
}

export const notificationService = new NotificationService();
