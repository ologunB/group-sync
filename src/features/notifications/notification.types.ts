import { Prisma } from '@prisma/client';

export const NOTIFICATION_TYPES = [
    'message',
    'message_reply',
    'application_submitted',
    'application_approved',
    'application_rejected',
    'member_joined',
    'event_created',
    'event_reminder',
    'event_cancelled',
    'event_updated',
    'group_announcement',
    'group_approved',
    'group_rejected',
    'group_deleted',
    'dm_received',
    'invite_received',
    'membership_updated',
    'system',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Types that may also be emailed.
 *
 * Deliberately excludes `message` and `dm_received`: one email per chat message is what
 * makes a product's email unreadable, and the in-app + push channels already cover it.
 * Everything here is either infrequent or time-critical enough to be worth an inbox slot.
 */
export const NOTIFICATION_EMAIL_TYPES: readonly NotificationType[] = [
    'message_reply',
    'application_approved',
    'application_rejected',
    'event_created',
    'event_reminder',
    'event_cancelled',
    'group_announcement',
    'group_approved',
    'group_rejected',
    'invite_received',
];

export interface ListNotificationsQuery {
    cursor?: string;
    limit?: number;
    unread_only?: boolean;
}

export interface UpdatePreferencesDTO {
    preferences: Array<{
        group_id?: string;
        pref_type: string;
        push_enabled?: boolean;
        in_app_enabled?: boolean;
        email_enabled?: boolean;
    }>;
}

export const notificationSelect = {
    id: true,
    userId: true,
    type: true,
    title: true,
    body: true,
    referenceType: true,
    referenceId: true,
    isRead: true,
    createdAt: true,
} as const satisfies Prisma.NotificationSelect;

export const notificationPrefSelect = {
    id: true,
    userId: true,
    groupId: true,
    prefType: true,
    pushEnabled: true,
    inAppEnabled: true,
    emailEnabled: true,
} as const satisfies Prisma.NotificationPreferenceSelect;

export type NotificationPublic = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;
export type NotificationPrefPublic = Prisma.NotificationPreferenceGetPayload<{ select: typeof notificationPrefSelect }>;
