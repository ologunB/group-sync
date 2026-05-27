"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuditLogger = exports.ResourceTypes = exports.LogActions = void 0;
const connection_1 = require("../../database/connection");
const asLogger_1 = require("./asLogger");
// ─── Action constants ─────────────────────────────────────────────────────────
exports.LogActions = {
    // Auth
    AUTH_REGISTER: 'auth.register',
    AUTH_LOGIN: 'auth.login',
    AUTH_SOCIAL_LOGIN: 'auth.social_login',
    AUTH_LOGOUT: 'auth.logout',
    AUTH_REFRESH_TOKEN: 'auth.refresh_token',
    AUTH_FORGOT_PASSWORD: 'auth.forgot_password',
    AUTH_RESET_PASSWORD: 'auth.reset_password',
    AUTH_CHANGE_PASSWORD: 'auth.change_password',
    AUTH_VERIFY_EMAIL: 'auth.verify_email',
    AUTH_RESEND_VERIFICATION: 'auth.resend_verification',
    AUTH_SUBMIT_ID_VERIFICATION: 'auth.submit_id_verification',
    AUTH_KYC_WEBHOOK: 'auth.kyc_webhook',
    // Users
    USER_UPDATE_PROFILE: 'user.update_profile',
    USER_DELETE_ACCOUNT: 'user.delete_account',
    USER_BLOCK: 'user.block',
    USER_UNBLOCK: 'user.unblock',
    // Groups
    GROUP_CREATE: 'group.create',
    GROUP_UPDATE: 'group.update',
    GROUP_DELETE: 'group.delete',
    GROUP_JOIN: 'group.join',
    GROUP_LEAVE: 'group.leave',
    GROUP_APPLY: 'group.apply',
    GROUP_APPLICATION_REVIEW: 'group.application_review',
    GROUP_INVITE_GENERATE: 'group.invite_generate',
    GROUP_INVITE_ACCEPT: 'group.invite_accept',
    GROUP_MEMBER_UPDATE: 'group.member_update',
    GROUP_MEMBER_REMOVE: 'group.member_remove',
    GROUP_VIEW: 'group.view',
    GROUP_APPLICATION_WITHDRAW: 'group.application_withdraw',
    GROUP_INVITE_REVOKE: 'group.invite_revoke',
    GROUP_FORM_UPSERT: 'group.form_upsert',
    // Events
    EVENT_CREATE: 'event.create',
    EVENT_UPDATE: 'event.update',
    EVENT_DELETE: 'event.delete',
    EVENT_RSVP: 'event.rsvp',
    EVENT_RSVP_UPDATE: 'event.rsvp_update',
    EVENT_RSVP_CANCEL: 'event.rsvp_cancel',
    // Notifications
    NOTIFICATION_READ: 'notification.read',
    NOTIFICATION_READ_ALL: 'notification.read_all',
    NOTIFICATION_DELETE: 'notification.delete',
    NOTIFICATION_PREF_UPDATE: 'notification.pref_update',
    // Reports
    REPORT_SUBMIT: 'report.submit',
    // Admin
    ADMIN_USER_UPDATE: 'admin.user_update',
    ADMIN_USER_VERIFY_ID: 'admin.user_verify_id',
    ADMIN_GROUP_UPDATE: 'admin.group_update',
    ADMIN_REPORT_RESOLVE: 'admin.report_resolve',
    // Messages
    MESSAGE_SEND: 'message.send',
    MESSAGE_DELETE: 'message.delete',
    MESSAGE_PIN: 'message.pin',
    POLL_VOTE: 'poll.vote',
    POLL_UNVOTE: 'poll.unvote',
    // DMs
    DM_SEND: 'dm.send',
    DM_REACTION_ADD: 'dm.reaction_add',
    DM_REACTION_REMOVE: 'dm.reaction_remove',
    // Chat admin
    CHAT_LOCK: 'chat.lock',
    CHAT_UNLOCK: 'chat.unlock',
};
// ─── Resource type constants ──────────────────────────────────────────────────
exports.ResourceTypes = {
    USER: 'user',
    GROUP: 'group',
    MEMBERSHIP: 'membership',
    APPLICATION: 'application',
    MESSAGE: 'message',
    EVENT: 'event',
    SESSION: 'session',
    REFRESH_TOKEN: 'refresh_token',
    INVITE_LINK: 'invite_link',
    NOTIFICATION: 'notification',
    REPORT: 'report',
    GROUP_FORM: 'group_form',
    DM: 'dm',
};
// ─── AuditLogger ──────────────────────────────────────────────────────────────
class AuditLogger {
    /**
     * Writes an audit log entry. This method deliberately swallows its own errors
     * so that a logging failure never breaks the main request/response flow.
     *
     * @param actor       - The authenticated user performing the action (null for system/unauthenticated)
     * @param action      - LogActions constant
     * @param entityType  - ResourceTypes constant
     * @param entityId    - UUID of the affected entity (null if not yet created)
     * @param status      - 1 = success, 0 = failure
     * @param metadata    - Any additional context; mask sensitive values before passing
     * @param ipAddress   - Caller IP address
     */
    // Non-blocking fire-and-forget. Callers may still `await` — it resolves immediately.
    static log(actor, action, entityType, entityId, status, metadata = {}, ipAddress) {
        connection_1.prisma.auditLog.create({
            data: {
                userId: actor?.userId ?? null,
                action,
                entityType,
                entityId: entityId ?? undefined,
                status,
                metadata: metadata,
                ipAddress: ipAddress ?? null,
            },
        }).catch((err) => {
            asLogger_1.asLogger.error('AuditLogger: failed to write audit entry', { action, entityType, err });
        });
    }
}
exports.AuditLogger = AuditLogger;
//# sourceMappingURL=audit.logger.js.map