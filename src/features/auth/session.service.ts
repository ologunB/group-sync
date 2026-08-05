import { redis } from '../../database/connection';

// ─── Redis key builders ───────────────────────────────────────────────────────

const Keys = {
    emailVerify: (email: string) => `verify:email:${email}`,
    forgotPassword: (email: string) => `verify:forgot:${email}`,
    loginFailed: (userId: string) => `login:failed:${userId}`,
    presence: (userId: string) => `presence:${userId}`,
    invite: (token: string) => `invite:${token}`,
    kycEvent: (eventId: string) => `kyc:event:${eventId}`,
    // Keyed by userId, not by phone number: the number lives encrypted on the user row
    // and a plaintext number in a Redis key would defeat that.
    phoneVerify: (userId: string) => `verify:phone:${userId}`,
    phoneResend: (userId: string) => `verify:phone:cooldown:${userId}`,
};

// ─── TTL constants (seconds) ──────────────────────────────────────────────────

const TTL = {
    EMAIL_VERIFY: 10 * 60,      // 10 minutes
    FORGOT_PASSWORD: 10 * 60,   // 10 minutes
    LOGIN_FAILED: 15 * 60,      // 15 minutes (window resets per first failure)
    PRESENCE: 90,                // 90 seconds (heartbeat refreshes)
    INVITE: 5 * 60,             // 5 minutes
    KYC_EVENT: 24 * 60 * 60,   // 24 hours
    PHONE_VERIFY: 10 * 60,      // 10 minutes
    PHONE_RESEND: 60,           // 60 seconds between sends
};

const MAX_FAILED_ATTEMPTS = 5;

// ─── SessionService ───────────────────────────────────────────────────────────

export class SessionService {
    // ── Email verification OTP ──────────────────────────────────────────────────

    static async setEmailVerificationOTP(email: string, otp: string): Promise<void> {
        await redis.setex(Keys.emailVerify(email), TTL.EMAIL_VERIFY, otp);
    }

    static async getEmailVerificationOTP(email: string): Promise<string | null> {
        return redis.get(Keys.emailVerify(email));
    }

    static async deleteEmailVerificationOTP(email: string): Promise<void> {
        await redis.del(Keys.emailVerify(email));
    }

    // ── Forgot password OTP ─────────────────────────────────────────────────────

    static async setForgotPasswordOTP(email: string, otp: string): Promise<void> {
        await redis.setex(Keys.forgotPassword(email), TTL.FORGOT_PASSWORD, otp);
    }

    static async getForgotPasswordOTP(email: string): Promise<string | null> {
        return redis.get(Keys.forgotPassword(email));
    }

    static async deleteForgotPasswordOTP(email: string): Promise<void> {
        await redis.del(Keys.forgotPassword(email));
    }

    // ── Phone verification OTP ──────────────────────────────────────────────────

    static async setPhoneVerificationOTP(userId: string, otp: string): Promise<void> {
        await redis.setex(Keys.phoneVerify(userId), TTL.PHONE_VERIFY, otp);
    }

    static async getPhoneVerificationOTP(userId: string): Promise<string | null> {
        return redis.get(Keys.phoneVerify(userId));
    }

    static async deletePhoneVerificationOTP(userId: string): Promise<void> {
        await redis.del(Keys.phoneVerify(userId));
    }

    /**
     * Returns true when the caller is allowed to trigger another SMS. SET NX means the
     * first caller inside the window wins and everyone after it is told to wait, which
     * keeps a retry loop from burning through SMS credit.
     */
    static async claimPhoneOtpSend(userId: string): Promise<boolean> {
        const result = await redis.set(Keys.phoneResend(userId), '1', 'EX', TTL.PHONE_RESEND, 'NX');
        return result === 'OK';
    }

    // ── Failed login tracking ───────────────────────────────────────────────────

    static async incrementFailedLogin(userId: string): Promise<number> {
        const key = Keys.loginFailed(userId);
        const count = await redis.incr(key);
        // Set TTL only on the first failure (so the window starts from the first bad attempt)
        if (count === 1) {
            await redis.expire(key, TTL.LOGIN_FAILED);
        }
        return count;
    }

    static async getFailedLoginCount(userId: string): Promise<number> {
        try {
            const raw = await redis.get(Keys.loginFailed(userId));
            return raw ? parseInt(raw, 10) : 0;
        } catch {
            return 0; // Redis unavailable — treat as no failures recorded
        }
    }

    static async clearFailedLogins(userId: string): Promise<void> {
        try {
            await redis.del(Keys.loginFailed(userId));
        } catch {
            // Non-critical: counter will expire naturally via TTL
        }
    }

    static async isAccountLocked(userId: string): Promise<boolean> {
        const count = await SessionService.getFailedLoginCount(userId);
        return count >= MAX_FAILED_ATTEMPTS;
    }

    // ── Presence ────────────────────────────────────────────────────────────────

    static async setPresence(userId: string): Promise<void> {
        await redis.setex(Keys.presence(userId), TTL.PRESENCE, '1');
    }

    static async isOnline(userId: string): Promise<boolean> {
        const exists = await redis.exists(Keys.presence(userId));
        return exists === 1;
    }

    static async clearPresence(userId: string): Promise<void> {
        await redis.del(Keys.presence(userId));
    }

    // ── Invite link cache ───────────────────────────────────────────────────────

    static async cacheInviteToken(token: string, groupId: string): Promise<void> {
        await redis.setex(Keys.invite(token), TTL.INVITE, groupId);
    }

    static async getInviteGroupId(token: string): Promise<string | null> {
        return redis.get(Keys.invite(token));
    }

    // ── KYC webhook idempotency ─────────────────────────────────────────────────
    // Returns true if this is a new event (NX succeeded), false if already processed

    static async markKycEventProcessed(eventId: string): Promise<boolean> {
        const result = await redis.set(
            Keys.kycEvent(eventId),
            '1',
            'EX',
            TTL.KYC_EVENT,
            'NX',
        );
        return result === 'OK';
    }
}
