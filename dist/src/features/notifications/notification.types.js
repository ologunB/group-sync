"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationPrefSelect = exports.notificationSelect = exports.NOTIFICATION_TYPES = void 0;
exports.NOTIFICATION_TYPES = [
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
};
//# sourceMappingURL=notification.types.js.map