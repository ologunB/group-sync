import { Prisma } from '@prisma/client';

export const NOTIFICATION_TYPES = [
    'message',
    'application_submitted',
    'application_approved',
    'application_rejected',
    'member_joined',
    'event_created',
    'group_announcement',
    'dm_received',
    'invite_received',
    'membership_updated',
    'system',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface ListNotificationsQuery {
    cursor?: string;
    limit?: number;
    unread_only?: boolean;
}

export interface UpdatePreferencesDTO {
    preferences: Array<{
        group_id?: string;
        pref_type: string;
        push_enabled: boolean;
        in_app_enabled: boolean;
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
} as const satisfies Prisma.NotificationPreferenceSelect;

export type NotificationPublic = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;
export type NotificationPrefPublic = Prisma.NotificationPreferenceGetPayload<{ select: typeof notificationPrefSelect }>;
