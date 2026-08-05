"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationPrefSelect = exports.notificationSelect = exports.NOTIFICATION_EMAIL_TYPES = exports.NOTIFICATION_TYPES = void 0;
exports.NOTIFICATION_TYPES = [
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
];
/**
 * Types that may also be emailed.
 *
 * Deliberately excludes `message` and `dm_received`: one email per chat message is what
 * makes a product's email unreadable, and the in-app + push channels already cover it.
 * Everything here is either infrequent or time-critical enough to be worth an inbox slot.
 */
exports.NOTIFICATION_EMAIL_TYPES = [
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
exports.notificationSelect = {
    id: true,
    userId: true,
    type: true,
    title: true,
    body: true,
    referenceType: true,
    referenceId: true,
    isRead: true,
    createdAt: true,
};
exports.notificationPrefSelect = {
    id: true,
    userId: true,
    groupId: true,
    prefType: true,
    pushEnabled: true,
    inAppEnabled: true,
    emailEnabled: true,
};
//# sourceMappingURL=notification.types.js.map