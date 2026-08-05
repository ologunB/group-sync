"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionService = void 0;
const connection_1 = require("../../database/connection");
// ─── Redis key builders ───────────────────────────────────────────────────────
const Keys = {
    emailVerify: (email) => `verify:email:${email}`,
    forgotPassword: (email) => `verify:forgot:${email}`,
    loginFailed: (userId) => `login:failed:${userId}`,
    presence: (userId) => `presence:${userId}`,
    invite: (token) => `invite:${token}`,
    kycEvent: (eventId) => `kyc:event:${eventId}`,
    // Keyed by userId, not by phone number: the number lives encrypted on the user row
    // and a plaintext number in a Redis key would defeat that.
    phoneVerify: (userId) => `verify:phone:${userId}`,
    phoneResend: (userId) => `verify:phone:cooldown:${userId}`,
};
// ─── TTL constants (seconds) ──────────────────────────────────────────────────
const TTL = {
    EMAIL_VERIFY: 10 * 60, // 10 minutes
    FORGOT_PASSWORD: 10 * 60, // 10 minutes
    LOGIN_FAILED: 15 * 60, // 15 minutes (window resets per first failure)
    PRESENCE: 90, // 90 seconds (heartbeat refreshes)
    INVITE: 5 * 60, // 5 minutes
    KYC_EVENT: 24 * 60 * 60, // 24 hours
    PHONE_VERIFY: 10 * 60, // 10 minutes
    PHONE_RESEND: 60, // 60 seconds between sends
};
const MAX_FAILED_ATTEMPTS = 5;
// ─── SessionService ───────────────────────────────────────────────────────────
class SessionService {
    // ── Email verification OTP ──────────────────────────────────────────────────
    static async setEmailVerificationOTP(email, otp) {
        await connection_1.redis.setex(Keys.emailVerify(email), TTL.EMAIL_VERIFY, otp);
    }
    static async getEmailVerificationOTP(email) {
        return connection_1.redis.get(Keys.emailVerify(email));
    }
    static async deleteEmailVerificationOTP(email) {
        await connection_1.redis.del(Keys.emailVerify(email));
    }
    // ── Forgot password OTP ─────────────────────────────────────────────────────
    static async setForgotPasswordOTP(email, otp) {
        await connection_1.redis.setex(Keys.forgotPassword(email), TTL.FORGOT_PASSWORD, otp);
    }
    static async getForgotPasswordOTP(email) {
        return connection_1.redis.get(Keys.forgotPassword(email));
    }
    static async deleteForgotPasswordOTP(email) {
        await connection_1.redis.del(Keys.forgotPassword(email));
    }
    // ── Phone verification OTP ──────────────────────────────────────────────────
    static async setPhoneVerificationOTP(userId, otp) {
        await connection_1.redis.setex(Keys.phoneVerify(userId), TTL.PHONE_VERIFY, otp);
    }
    static async getPhoneVerificationOTP(userId) {
        return connection_1.redis.get(Keys.phoneVerify(userId));
    }
    static async deletePhoneVerificationOTP(userId) {
        await connection_1.redis.del(Keys.phoneVerify(userId));
    }
    /**
     * Returns true when the caller is allowed to trigger another SMS. SET NX means the
     * first caller inside the window wins and everyone after it is told to wait, which
     * keeps a retry loop from burning through SMS credit.
     */
    static async claimPhoneOtpSend(userId) {
        const result = await connection_1.redis.set(Keys.phoneResend(userId), '1', 'EX', TTL.PHONE_RESEND, 'NX');
        return result === 'OK';
    }
    // ── Failed login tracking ───────────────────────────────────────────────────
    static async incrementFailedLogin(userId) {
        const key = Keys.loginFailed(userId);
        const count = await connection_1.redis.incr(key);
        // Set TTL only on the first failure (so the window starts from the first bad attempt)
        if (count === 1) {
            await connection_1.redis.expire(key, TTL.LOGIN_FAILED);
        }
        return count;
    }
    static async getFailedLoginCount(userId) {
        try {
            const raw = await connection_1.redis.get(Keys.loginFailed(userId));
            return raw ? parseInt(raw, 10) : 0;
        }
        catch {
            return 0; // Redis unavailable — treat as no failures recorded
        }
    }
    static async clearFailedLogins(userId) {
        try {
            await connection_1.redis.del(Keys.loginFailed(userId));
        }
        catch {
            // Non-critical: counter will expire naturally via TTL
        }
    }
    static async isAccountLocked(userId) {
        const count = await SessionService.getFailedLoginCount(userId);
        return count >= MAX_FAILED_ATTEMPTS;
    }
    // ── Presence ────────────────────────────────────────────────────────────────
    static async setPresence(userId) {
        await connection_1.redis.setex(Keys.presence(userId), TTL.PRESENCE, '1');
    }
    static async isOnline(userId) {
        const exists = await connection_1.redis.exists(Keys.presence(userId));
        return exists === 1;
    }
    static async clearPresence(userId) {
        await connection_1.redis.del(Keys.presence(userId));
    }
    // ── Invite link cache ───────────────────────────────────────────────────────
    static async cacheInviteToken(token, groupId) {
        await connection_1.redis.setex(Keys.invite(token), TTL.INVITE, groupId);
    }
    static async getInviteGroupId(token) {
        return connection_1.redis.get(Keys.invite(token));
    }
    // ── KYC webhook idempotency ─────────────────────────────────────────────────
    // Returns true if this is a new event (NX succeeded), false if already processed
    static async markKycEventProcessed(eventId) {
        const result = await connection_1.redis.set(Keys.kycEvent(eventId), '1', 'EX', TTL.KYC_EVENT, 'NX');
        return result === 'OK';
    }
}
exports.SessionService = SessionService;
//# sourceMappingURL=session.service.js.map