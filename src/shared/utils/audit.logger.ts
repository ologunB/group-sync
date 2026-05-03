import { prisma } from '../../database/connection';
import { asLogger } from './asLogger';
import { TokenPayload } from '../types/common.types';

// ─── Action constants ─────────────────────────────────────────────────────────

export const LogActions = {
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
} as const;

export type LogAction = (typeof LogActions)[keyof typeof LogActions];

// ─── Resource type constants ──────────────────────────────────────────────────

export const ResourceTypes = {
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
} as const;

export type ResourceType = (typeof ResourceTypes)[keyof typeof ResourceTypes];

// ─── AuditLogger ──────────────────────────────────────────────────────────────

export class AuditLogger {
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
    static async log(
        actor: TokenPayload | null | undefined,
        action: string,
        entityType: string,
        entityId: string | null,
        status: 0 | 1,
        metadata: Record<string, unknown> = {},
        ipAddress?: string,
    ): Promise<void> {
        try {
            await prisma.auditLog.create({
                data: {
                    userId: actor?.userId ?? null,
                    action,
                    entityType,
                    entityId: entityId ?? undefined,
                    status,
                    metadata,
                    ipAddress: ipAddress ?? null,
                },
            });
        } catch (err) {
            asLogger.error('AuditLogger: failed to write audit entry', { action, entityType, err });
        }
    }
}
