import { randomUUID } from 'crypto';
import { StatusCodes } from 'http-status-codes';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../../database/connection';
import { Messages } from '../../shared/utils/response.constants';
import { ApiError } from '../../shared/middleware/error.middleware';
import { asLogger } from '../../shared/utils/asLogger';
import { AuditLogger, LogActions, ResourceTypes } from '../../shared/utils/audit.logger';
import { AgendaManager } from '../../agenda';
import { SessionService } from './session.service';
import { config } from '../../shared/config/app.config';
import { TokenPayload } from '../../shared/types/common.types';
import { PlatformRolePermissions } from '../../shared/utils/permissions.constants';
import {
    RegisterDTO,
    LoginDTO,
    SocialLoginDTO,
    LogoutDTO,
    RefreshTokenDTO,
    ForgotPasswordDTO,
    ResetPasswordDTO,
    ChangePasswordDTO,
    VerifyEmailDTO,
    ResendVerificationDTO,
    SubmitIdVerificationDTO,
    KycWebhookDTO,
    SendPhoneOtpDTO,
    VerifyPhoneOtpDTO,
    AuthResult,
    RegisterResult,
    TokenPair,
    SafeUser,
    userSafeSelect, VerifyForgotOtpDTO,
} from './auth.types';
import {EncryptionUtil} from "../../shared/utils/encryption";
import { verifyAppleIdToken } from './apple.verifier';
import { SmsService } from '../../shared/queues/sms.service';

// ─── Google OAuth client ──────────────────────────────────────────────────────

const googleClient = new OAuth2Client(config.oauth.googleClientId);

/** The subset of Google's ID token payload this service reads. */
type TokenPayloadFromGoogle = {
    sub?: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REFRESH_TOKEN_EXPIRES_MS = config.jwt.refreshExpiresInMs; // 30 days

function buildTokenPayload(userId: string, sessionId: string, role: string = 'user'): TokenPayload {
    const permissions = (PlatformRolePermissions[role] ?? []) as string[];
    return { userId, role, sessionId, permissions };
}

/** Interests are a free-text tag array — lowercase and dedupe so filters match. */
function normalizeInterests(interests?: string[]): string[] {
    if (!interests?.length) return [];
    return [...new Set(interests.map((t) => t.toLowerCase().trim()))].filter(Boolean);
}

function stripSensitiveFields<T extends Record<string, unknown>>(user: T): SafeUser {
    const {
        passwordHash: _ph,
        phone: _p,
        phoneIv: _piv,
        phoneHash: _phash,
        idDocumentUrl: _idu,
        idDocumentIv: _idiv,
        deletedAt: _da,
        ...safe
    } = user;
    return safe as unknown as SafeUser;
}

// ─── AuthService ──────────────────────────────────────────────────────────────

export class AuthService {
    // ── register ─────────────────────────────────────────────────────────────────

    async register(dto: RegisterDTO, ipAddress: string): Promise<RegisterResult> {
        const email = dto.email.toLowerCase();

        try {
            // Compute phone hash early so the uniqueness check can run in parallel
            const rawPhoneHash = dto.phone ? EncryptionUtil.hashPhone(dto.phone) : undefined;

            // Parallel: email uniqueness + phone uniqueness + bcrypt hash
            const [existing, phoneExists, passwordHash] = await Promise.all([
                prisma.user.findUnique({ where: { email }, select: { id: true } }),
                rawPhoneHash
                    ? prisma.user.findUnique({ where: { phoneHash: rawPhoneHash }, select: { id: true } })
                    : Promise.resolve(null),
                EncryptionUtil.hashPassword(dto.password),
            ]);

            if (existing) throw new ApiError(Messages.EMAIL_ALREADY_EXISTS, StatusCodes.CONFLICT);
            if (phoneExists) throw new ApiError('Phone number is already in use.', StatusCodes.CONFLICT);

            // Encrypt phone fields (cheap, synchronous)
            let phone: string | undefined;
            let phoneIv: string | undefined;
            let phoneHash: string | undefined;
            if (dto.phone && rawPhoneHash) {
                const encrypted = EncryptionUtil.encryptField(dto.phone);
                phone    = encrypted.ciphertext;
                phoneIv  = encrypted.iv;
                phoneHash = rawPhoneHash;
            }

            const userId = randomUUID();

            const user = await prisma.user.create({
                data: {
                    id: userId,
                    email,
                    displayName: dto.display_name.trim(),
                    passwordHash,
                    phone,
                    phoneIv,
                    phoneHash,
                    city:    dto.city?.trim() ?? null,
                    state:   dto.state?.trim() ?? null,
                    country: dto.country?.trim() ?? 'NG',
                    interests: normalizeInterests(dto.interests),
                },
                select: userSafeSelect,
            });

            // Parallel: store OTP in Redis + enqueue verification email
            const otp = EncryptionUtil.generateOTP();
            await Promise.all([
                SessionService.setEmailVerificationOTP(email, otp),
                AgendaManager.sendEmail({
                    to: email,
                    subject: 'Verify your GroupSync email',
                    template: 'verify_email',
                    data: { displayName: user.displayName, otp, clientUrl: config.server.clientUrl },
                }),
            ]);

            AuditLogger.log(
                buildTokenPayload(userId, 'pre-verify'),
                LogActions.AUTH_REGISTER, ResourceTypes.USER, userId, 1, { email }, ipAddress,
            );

            return { user };
        } catch (error: any) {
            AuditLogger.log(null, LogActions.AUTH_REGISTER, ResourceTypes.USER, null, 0, { email, error: error.message }, ipAddress);
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.register:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── login ─────────────────────────────────────────────────────────────────────

    async login(dto: LoginDTO, ipAddress: string): Promise<AuthResult> {
        const email = dto.email.toLowerCase();

        try {
            const rawUser = await prisma.user.findUnique({
                where: { email },
                select: {
                    ...userSafeSelect,
                    passwordHash: true,
                    deletedAt: true,
                    emailVerifiedAt: true,
                },
            });

            // Always throw the same error to prevent email enumeration
            if (!rawUser || rawUser.deletedAt) {
                throw new ApiError(Messages.INVALID_CREDENTIALS, StatusCodes.UNAUTHORIZED);
            }

            if (rawUser.status === 'suspended') {
                throw new ApiError(Messages.ACCOUNT_SUSPENDED, StatusCodes.FORBIDDEN);
            }
            if (rawUser.status === 'banned') {
                throw new ApiError(Messages.ACCOUNT_BANNED, StatusCodes.FORBIDDEN);
            }

            // Lock check — must happen before password check
            const isLocked = await SessionService.isAccountLocked(rawUser.id);
            if (isLocked) {
                throw new ApiError(Messages.ACCOUNT_LOCKED, StatusCodes.TOO_MANY_REQUESTS);
            }

            // Password-only accounts
            if (!rawUser.passwordHash) {
                throw new ApiError(
                    'This account uses social sign-in. Please log in with your provider.',
                    StatusCodes.UNAUTHORIZED,
                );
            }

            const passwordValid = await EncryptionUtil.comparePassword(dto.password, rawUser.passwordHash);
            if (!passwordValid) {
                const failedCount = await SessionService.incrementFailedLogin(rawUser.id);
                if (failedCount >= 5) {
                    AuditLogger.log(
                        null, LogActions.AUTH_LOGIN, ResourceTypes.USER, rawUser.id, 0,
                        { email, reason: 'account_locked_after_failures' }, ipAddress,
                    );
                    throw new ApiError(Messages.ACCOUNT_LOCKED, StatusCodes.TOO_MANY_REQUESTS);
                }
                throw new ApiError(Messages.INVALID_CREDENTIALS, StatusCodes.UNAUTHORIZED);
            }

            // Password is valid — now gate on email verification
            if (!rawUser.emailVerifiedAt) {
                throw new ApiError(Messages.EMAIL_NOT_VERIFIED, StatusCodes.FORBIDDEN);
            }

            const sessionId = EncryptionUtil.generateRandomToken(16);
            const tokenPayload = buildTokenPayload(rawUser.id, sessionId, rawUser.role);
            const tokens = EncryptionUtil.generateTokens(tokenPayload, ipAddress);
            const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);

            // Parallel: clear Redis failure counter + write DB session
            await Promise.all([
                SessionService.clearFailedLogins(rawUser.id),
                prisma.$transaction(async (tx) => {
                    await tx.user.update({ where: { id: rawUser.id }, data: { lastLoginAt: new Date() } });
                    await tx.refreshToken.create({
                        data: { userId: rawUser.id, token: tokens.refreshToken, expiresAt: refreshExpiresAt, createdByIp: ipAddress },
                    });
                    await tx.session.create({ data: { userId: rawUser.id, ipAddress, expiresAt: refreshExpiresAt } });
                }),
            ]);

            const user = stripSensitiveFields(rawUser as any);

            AuditLogger.log(tokenPayload, LogActions.AUTH_LOGIN, ResourceTypes.USER, rawUser.id, 1, { email }, ipAddress);

            return { user, tokens };
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.login:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── socialLogin ───────────────────────────────────────────────────────────────

    async socialLogin(dto: SocialLoginDTO, ipAddress: string): Promise<AuthResult> {
        try {
            let providerEmail: string | undefined;
            let providerId: string;
            let displayName: string;
            let emailVerifiedByProvider = false;

            if (dto.provider === 'google') {
                if (!config.oauth.googleClientId) {
                    throw new ApiError(
                        'Google Sign-In is not configured on this server (GOOGLE_CLIENT_ID is unset).',
                        StatusCodes.NOT_IMPLEMENTED,
                    );
                }

                // google-auth-library throws plain Errors for a malformed token, a wrong
                // audience or an expired one. Left unmapped they hit the catch-all below
                // and surface as a 500 — a client-side problem reported as a server fault,
                // which is exactly the wrong thing to hand someone debugging their setup.
                let payload: TokenPayloadFromGoogle;
                try {
                    const ticket = await googleClient.verifyIdToken({
                        idToken: dto.token,
                        audience: config.oauth.googleClientId,
                    });
                    payload = ticket.getPayload() as TokenPayloadFromGoogle;
                } catch (verifyError: any) {
                    asLogger.warn('Google ID token rejected', { reason: verifyError.message });
                    throw new ApiError(
                        `${Messages.SOCIAL_TOKEN_INVALID} (${verifyError.message})`,
                        StatusCodes.UNAUTHORIZED,
                    );
                }

                if (!payload || !payload.sub) {
                    throw new ApiError(Messages.SOCIAL_TOKEN_INVALID, StatusCodes.UNAUTHORIZED);
                }
                providerId = payload.sub;
                providerEmail = payload.email;
                displayName = payload.name ?? dto.display_name ?? payload.email ?? 'User';
                emailVerifiedByProvider = payload.email_verified === true;
            } else {
                const identity = await verifyAppleIdToken(dto.token);
                providerId = identity.providerId;
                providerEmail = identity.email;
                // Apple never puts the name in the identity token — the client forwards it on
                // first authorisation. Private-relay addresses make a poor fallback name, so
                // 'User' is preferable to showing someone @privaterelay.appleid.com.
                displayName = dto.display_name?.trim() || 'User';
                emailVerifiedByProvider = identity.emailVerified;
            }

            let isNewUser = false;

            // Check if a provider link already exists
            const existingProvider = await prisma.userProvider.findUnique({
                where: { provider_providerId: { provider: dto.provider, providerId } },
                select: { userId: true },
            });

            let userId: string;

            if (existingProvider) {
                // Known provider → sign in
                userId = existingProvider.userId;
            } else if (providerEmail) {
                // Check if an account with this email exists (link the provider)
                const existingUser = await prisma.user.findUnique({
                    where: { email: providerEmail.toLowerCase() },
                    select: { id: true, emailVerifiedAt: true },
                });

                if (existingUser) {
                    // Link provider to an existing account
                    await prisma.userProvider.create({
                        data: {
                            userId: existingUser.id,
                            provider: dto.provider,
                            providerId,
                            email: providerEmail.toLowerCase(),
                        },
                    });
                    userId = existingUser.id;

                    // An account created with email+password that never confirmed its address
                    // is confirmed by the provider vouching for the same address.
                    if (emailVerifiedByProvider && !existingUser.emailVerifiedAt) {
                        await prisma.user.update({
                            where: { id: existingUser.id },
                            data: { emailVerifiedAt: new Date() },
                        });
                    }
                } else {
                    // Create new user + provider link
                    isNewUser = true;
                    userId = randomUUID();

                    // Batched rather than interactive. The user ID is generated up front, so
                    // the second write never needs the first one's result — and an interactive
                    // transaction would hold a connection open across two sequential
                    // round-trips, which blows Prisma's 5s ceiling on a slow link to the
                    // database and 500s a sign-up that was otherwise fine.
                    await prisma.$transaction([
                        prisma.user.create({
                            data: {
                                id: userId,
                                email: providerEmail!.toLowerCase(),
                                displayName,
                                // Google and Apple have already proven ownership of the address.
                                // Re-challenging with our own OTP would be pure friction.
                                emailVerifiedAt: emailVerifiedByProvider ? new Date() : null,
                            },
                        }),
                        prisma.userProvider.create({
                            data: { userId, provider: dto.provider, providerId, email: providerEmail!.toLowerCase() },
                        }),
                    ]);
                }
            } else {
                throw new ApiError(
                    'Could not retrieve email from social provider. Please ensure email access is granted.',
                    StatusCodes.UNPROCESSABLE_ENTITY,
                );
            }

            // Fetch safe user
            const user = await prisma.user.findUniqueOrThrow({
                where: { id: userId },
                select: userSafeSelect,
            });

            const sessionId = EncryptionUtil.generateRandomToken(16);
            const tokenPayload = buildTokenPayload(userId, sessionId, user.role);
            const tokens = EncryptionUtil.generateTokens(tokenPayload, ipAddress);
            const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);

            // Three independent writes keyed on an ID we already hold — batched for the same
            // reason as the sign-up transaction above.
            await prisma.$transaction([
                prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }),
                prisma.refreshToken.create({
                    data: { userId, token: tokens.refreshToken, expiresAt: refreshExpiresAt, createdByIp: ipAddress },
                }),
                prisma.session.create({
                    data: { userId, ipAddress, expiresAt: refreshExpiresAt },
                }),
            ]);

            AuditLogger.log(
                tokenPayload, LogActions.AUTH_SOCIAL_LOGIN, ResourceTypes.USER, userId, 1,
                { provider: dto.provider, isNewUser }, ipAddress,
            );

            return { user, tokens, isNewUser };
        } catch (error: any) {
            AuditLogger.log(
                null, LogActions.AUTH_SOCIAL_LOGIN, ResourceTypes.USER, null, 0,
                { provider: dto.provider, error: error.message }, ipAddress,
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.socialLogin:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── logout ────────────────────────────────────────────────────────────────────

    async logout(dto: LogoutDTO, actor: TokenPayload, ipAddress: string): Promise<void> {
        try {
            // Revoke the provided refresh token
            const updated = await prisma.refreshToken.updateMany({
                where: {
                    token: dto.refresh_token,
                    userId: actor.userId,
                    revokedAt: null,
                },
                data: { revokedAt: new Date() },
            });

            if (updated.count === 0) {
                // Token isn't found or already revoked — still return success (idempotent)
                asLogger.warn('AuthService.logout: refresh token not found or already revoked', {
                    userId: actor.userId,
                });
            }

            // Revoke the active session associated with this sessionId
            await prisma.session.updateMany({
                where: { userId: actor.userId, revokedAt: null },
                data: { revokedAt: new Date() },
            });

            await SessionService.clearPresence(actor.userId);

            AuditLogger.log(
                actor, LogActions.AUTH_LOGOUT, ResourceTypes.SESSION, actor.userId, 1, {}, ipAddress,
            );
        } catch (error: any) {
            AuditLogger.log(
                actor, LogActions.AUTH_LOGOUT, ResourceTypes.SESSION, actor.userId, 0,
                { error: error.message }, ipAddress,
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.logout:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── refresh ───────────────────────────────────────────────────────────────────

    async refresh(dto: RefreshTokenDTO, ipAddress: string): Promise<TokenPair> {
        try {
            const existing = await prisma.refreshToken.findUnique({
                where: { token: dto.refresh_token },
                include: { user: { select: { id: true, status: true, role: true, deletedAt: true } } },
            });

            if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
                throw new ApiError(Messages.REFRESH_TOKEN_INVALID, StatusCodes.UNAUTHORIZED);
            }

            if (existing.user.deletedAt || existing.user.status === 'banned') {
                throw new ApiError(Messages.ACCOUNT_BANNED, StatusCodes.FORBIDDEN);
            }

            if (existing.user.status === 'suspended') {
                throw new ApiError(Messages.ACCOUNT_SUSPENDED, StatusCodes.FORBIDDEN);
            }

            const sessionId = EncryptionUtil.generateRandomToken(16);
            const tokenPayload = buildTokenPayload(existing.userId, sessionId, existing.user.role);
            const tokens = EncryptionUtil.generateTokens(tokenPayload, ipAddress);
            const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);

            // Rotate: revoke an old token, issue a new one (atomic)
            await prisma.$transaction(async (tx) => {
                await tx.refreshToken.update({
                    where: { id: existing.id },
                    data: { revokedAt: new Date() },
                });
                await tx.refreshToken.create({
                    data: {
                        userId: existing.userId,
                        token: tokens.refreshToken,
                        expiresAt: refreshExpiresAt,
                        createdByIp: ipAddress,
                    },
                });
            });

            AuditLogger.log(
                tokenPayload, LogActions.AUTH_REFRESH_TOKEN, ResourceTypes.REFRESH_TOKEN,
                existing.userId, 1, {}, ipAddress,
            );

            return tokens;
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.refresh:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── forgotPassword ────────────────────────────────────────────────────────────

    async forgotPassword(dto: ForgotPasswordDTO, ipAddress: string): Promise<void> {
        const email = dto.email.toLowerCase();

        try {
            // Look up user — but always return the same response to prevent email enumeration
            const user = await prisma.user.findUnique({
                where: { email },
                select: { id: true, displayName: true, deletedAt: true },
            });

            if (user && !user.deletedAt) {
                const otp = EncryptionUtil.generateOTP();
                await SessionService.setForgotPasswordOTP(email, otp);
                await AgendaManager.sendEmail({
                    to: email,
                    subject: 'Reset your GroupSync password',
                    template: 'forgot_password',
                    data: { displayName: user.displayName, otp, clientUrl: config.server.clientUrl },
                });

                AuditLogger.log(
                    null, LogActions.AUTH_FORGOT_PASSWORD, ResourceTypes.USER, user.id, 1,
                    { email }, ipAddress,
                );
            }
            // If user not found, we still return success (no-op) — no audit failure log
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.forgotPassword:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async verifyForgotOtp(dto: VerifyForgotOtpDTO, ipAddress: string): Promise<void> {
        const email = dto.email.toLowerCase();

        try {
            const storedOtp = await SessionService.getForgotPasswordOTP(email);

            if (!storedOtp || storedOtp !== dto.otp) {
                throw new ApiError(Messages.INVALID_VERIFICATION_CODE, StatusCodes.BAD_REQUEST);
            }

            // OTP is valid — do NOT delete it here, so resetPassword can still consume it
            AuditLogger.log(
                null,
                LogActions.AUTH_FORGOT_PASSWORD,
                ResourceTypes.USER,
                null,
                1,
                { email, step: 'otp_verified' },
                ipAddress,
            );
        } catch (error: any) {
            AuditLogger.log(
                null,
                LogActions.AUTH_FORGOT_PASSWORD,
                ResourceTypes.USER,
                null,
                0,
                { email, step: 'otp_verify_failed', error: error.message },
                ipAddress,
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.verifyForgotOtp:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── resetPassword ─────────────────────────────────────────────────────────────

    async resetPassword(dto: ResetPasswordDTO, ipAddress: string): Promise<void> {
        const email = dto.email.toLowerCase();

        try {
            const storedOtp = await SessionService.getForgotPasswordOTP(email);

            if (!storedOtp || storedOtp !== dto.otp) {
                throw new ApiError(Messages.INVALID_VERIFICATION_CODE, StatusCodes.BAD_REQUEST);
            }

            const user = await prisma.user.findUnique({
                where: { email },
                select: { id: true, deletedAt: true },
            });

            if (!user || user.deletedAt) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            const passwordHash = await EncryptionUtil.hashPassword(dto.password);

            // Reset password + revoke all refresh tokens (force re-login everywhere)
            await prisma.$transaction(async (tx) => {
                await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
                await tx.refreshToken.updateMany({
                    where: { userId: user.id, revokedAt: null },
                    data: { revokedAt: new Date() },
                });
            });

            await SessionService.deleteForgotPasswordOTP(email);
            await SessionService.clearFailedLogins(user.id);

            AuditLogger.log(
                null, LogActions.AUTH_RESET_PASSWORD, ResourceTypes.USER, user.id, 1,
                { email }, ipAddress,
            );
        } catch (error: any) {
            AuditLogger.log(
                null, LogActions.AUTH_RESET_PASSWORD, ResourceTypes.USER, null, 0,
                { email, error: error.message }, ipAddress,
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.resetPassword:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── changePassword ────────────────────────────────────────────────────────────

    async changePassword(
        dto: ChangePasswordDTO,
        actor: TokenPayload,
        ipAddress: string,
    ): Promise<void> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: actor.userId },
                select: { id: true, passwordHash: true, deletedAt: true },
            });

            if (!user || user.deletedAt) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            if (!user.passwordHash) {
                throw new ApiError(
                    'This account uses social sign-in and has no password to change.',
                    StatusCodes.BAD_REQUEST,
                );
            }

            const oldPasswordValid = await EncryptionUtil.comparePassword(
                dto.old_password,
                user.passwordHash,
            );
            if (!oldPasswordValid) {
                throw new ApiError(Messages.INCORRECT_OLD_PASSWORD, StatusCodes.BAD_REQUEST);
            }

            const newPasswordHash = await EncryptionUtil.hashPassword(dto.new_password);

            await prisma.user.update({
                where: { id: user.id },
                data: { passwordHash: newPasswordHash },
            });

            AuditLogger.log(
                actor, LogActions.AUTH_CHANGE_PASSWORD, ResourceTypes.USER, user.id, 1, {}, ipAddress,
            );
        } catch (error: any) {
            AuditLogger.log(
                actor, LogActions.AUTH_CHANGE_PASSWORD, ResourceTypes.USER, actor.userId, 0,
                { error: error.message }, ipAddress,
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.changePassword:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── verifyEmail ───────────────────────────────────────────────────────────────

    async verifyEmail(dto: VerifyEmailDTO, ipAddress: string): Promise<AuthResult> {
        const email = dto.email.toLowerCase();

        try {
            const storedOtp = await SessionService.getEmailVerificationOTP(email);

            if (!storedOtp || storedOtp !== dto.otp) {
                throw new ApiError(Messages.INVALID_VERIFICATION_CODE, StatusCodes.BAD_REQUEST);
            }

            const rawUser = await prisma.user.findUnique({
                where: { email },
                select: { ...userSafeSelect, deletedAt: true },
            });

            if (!rawUser || rawUser.deletedAt) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            const sessionId = EncryptionUtil.generateRandomToken(16);
            const tokenPayload = buildTokenPayload(rawUser.id, sessionId, rawUser.role);
            const tokens = EncryptionUtil.generateTokens(tokenPayload, ipAddress);
            const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);

            const user = await prisma.$transaction(async (tx) => {
                const updated = await tx.user.update({
                    where: { id: rawUser.id },
                    data: { emailVerifiedAt: new Date() },
                    select: userSafeSelect,
                });
                await tx.refreshToken.create({
                    data: { userId: rawUser.id, token: tokens.refreshToken, expiresAt: refreshExpiresAt, createdByIp: ipAddress },
                });
                await tx.session.create({ data: { userId: rawUser.id, ipAddress, expiresAt: refreshExpiresAt } });
                return updated;
            });

            await SessionService.deleteEmailVerificationOTP(email);

            // Queue welcome email
            await AgendaManager.sendEmail({
                to: email,
                subject: 'Welcome to GroupSync!',
                template: 'welcome',
                data: { displayName: user.displayName, clientUrl: config.server.clientUrl },
            });

            AuditLogger.log(
                tokenPayload, LogActions.AUTH_VERIFY_EMAIL, ResourceTypes.USER, user.id, 1,
                { email }, ipAddress,
            );

            return { user, tokens };
        } catch (error: any) {
            AuditLogger.log(
                null, LogActions.AUTH_VERIFY_EMAIL, ResourceTypes.USER, null, 0,
                { email, error: error.message }, ipAddress,
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.verifyEmail:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── resendVerification ────────────────────────────────────────────────────────

    async resendVerification(dto: ResendVerificationDTO, ipAddress: string): Promise<void> {
        const email = dto.email.toLowerCase();

        try {
            const user = await prisma.user.findUnique({
                where: { email },
                select: { id: true, displayName: true, emailVerifiedAt: true, deletedAt: true },
            });

            // Always return success — prevents email enumeration
            if (!user || user.deletedAt) return;

            if (user.emailVerifiedAt) {
                // Already verified — silently succeed, no harm
                return;
            }

            const otp = EncryptionUtil.generateOTP();
            await SessionService.setEmailVerificationOTP(email, otp);
            await AgendaManager.sendEmail({
                to: email,
                subject: 'Your GroupSync verification code',
                template: 'verify_email',
                data: { displayName: user.displayName, otp, clientUrl: config.server.clientUrl },
            });

            AuditLogger.log(
                null, LogActions.AUTH_RESEND_VERIFICATION, ResourceTypes.USER, user.id, 1,
                { email }, ipAddress,
            );
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.resendVerification:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── sendPhoneOtp ──────────────────────────────────────────────────────────────
    // Tier 1 of the verification ladder. The caller may supply a new number, which
    // replaces whatever is on file — useful when a social sign-up had no phone at all.

    async sendPhoneOtp(
        dto: SendPhoneOtpDTO,
        actor: TokenPayload,
        ipAddress: string,
    ): Promise<{ phoneVerified: boolean }> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: actor.userId },
                select: {
                    id: true,
                    displayName: true,
                    phone: true,
                    phoneIv: true,
                    phoneVerifiedAt: true,
                    deletedAt: true,
                },
            });

            if (!user || user.deletedAt) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            let targetPhone: string;

            if (dto.phone) {
                const rawPhoneHash = EncryptionUtil.hashPhone(dto.phone);
                const taken = await prisma.user.findFirst({
                    where: { phoneHash: rawPhoneHash, id: { not: user.id } },
                    select: { id: true },
                });
                if (taken) {
                    throw new ApiError('Phone number is already in use.', StatusCodes.CONFLICT);
                }

                const encrypted = EncryptionUtil.encryptField(dto.phone);
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        phone: encrypted.ciphertext,
                        phoneIv: encrypted.iv,
                        phoneHash: rawPhoneHash,
                        // Changing the number invalidates any prior verification.
                        phoneVerifiedAt: null,
                    },
                });
                targetPhone = dto.phone;
            } else {
                if (user.phoneVerifiedAt) {
                    throw new ApiError(Messages.PHONE_ALREADY_VERIFIED, StatusCodes.CONFLICT);
                }
                if (!user.phone || !user.phoneIv) {
                    throw new ApiError(Messages.PHONE_REQUIRED, StatusCodes.BAD_REQUEST);
                }
                targetPhone = EncryptionUtil.decryptField(user.phone, user.phoneIv);
            }

            const canSend = await SessionService.claimPhoneOtpSend(user.id);
            if (!canSend) {
                throw new ApiError(
                    'A verification code was just sent. Please wait a minute before requesting another.',
                    StatusCodes.TOO_MANY_REQUESTS,
                );
            }

            const otp = EncryptionUtil.generateOTP();
            await SessionService.setPhoneVerificationOTP(user.id, otp);

            // Sent inline rather than queued: SmsService is a single outbound call and the
            // user is staring at the code entry screen. A queue hop only adds latency here.
            await SmsService.send({
                to: targetPhone,
                message: `${otp} is your GroupSync verification code. It expires in 10 minutes.`,
            });

            AuditLogger.log(
                actor, LogActions.AUTH_SEND_PHONE_OTP, ResourceTypes.USER, user.id, 1,
                { replacedNumber: Boolean(dto.phone) }, ipAddress,
            );

            return { phoneVerified: false };
        } catch (error: any) {
            AuditLogger.log(
                actor, LogActions.AUTH_SEND_PHONE_OTP, ResourceTypes.USER, actor.userId, 0,
                { error: error.message }, ipAddress,
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.sendPhoneOtp:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── verifyPhoneOtp ────────────────────────────────────────────────────────────

    async verifyPhoneOtp(
        dto: VerifyPhoneOtpDTO,
        actor: TokenPayload,
        ipAddress: string,
    ): Promise<{ phoneVerified: boolean; phoneVerifiedAt: Date }> {
        try {
            const storedOtp = await SessionService.getPhoneVerificationOTP(actor.userId);

            if (!storedOtp || storedOtp !== dto.otp) {
                throw new ApiError(Messages.INVALID_VERIFICATION_CODE, StatusCodes.BAD_REQUEST);
            }

            const user = await prisma.user.findUnique({
                where: { id: actor.userId },
                select: { id: true, deletedAt: true, phone: true },
            });

            if (!user || user.deletedAt) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            if (!user.phone) {
                throw new ApiError(Messages.PHONE_REQUIRED, StatusCodes.BAD_REQUEST);
            }

            const phoneVerifiedAt = new Date();
            await prisma.user.update({
                where: { id: user.id },
                data: { phoneVerifiedAt },
            });

            await SessionService.deletePhoneVerificationOTP(user.id);

            AuditLogger.log(
                actor, LogActions.AUTH_VERIFY_PHONE, ResourceTypes.USER, user.id, 1, {}, ipAddress,
            );

            return { phoneVerified: true, phoneVerifiedAt };
        } catch (error: any) {
            AuditLogger.log(
                actor, LogActions.AUTH_VERIFY_PHONE, ResourceTypes.USER, actor.userId, 0,
                { error: error.message }, ipAddress,
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.verifyPhoneOtp:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── submitIdVerification ──────────────────────────────────────────────────────

    async submitIdVerification(
        dto: SubmitIdVerificationDTO,
        actor: TokenPayload,
        ipAddress: string,
    ): Promise<{ idVerificationStatus: string }> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: actor.userId },
                select: { id: true, idVerificationStatus: true, deletedAt: true },
            });

            if (!user || user.deletedAt) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            if (user.idVerificationStatus === 'verified') {
                throw new ApiError(Messages.KYC_ALREADY_VERIFIED, StatusCodes.CONFLICT);
            }

            if (user.idVerificationStatus === 'pending') {
                throw new ApiError(Messages.KYC_ALREADY_SUBMITTED, StatusCodes.CONFLICT);
            }

            // Encrypt the document URL before storing
            const encrypted = EncryptionUtil.encryptField(dto.document_url);

            await prisma.user.update({
                where: { id: user.id },
                data: {
                    idDocumentUrl: encrypted.ciphertext,
                    idDocumentIv: encrypted.iv,
                    idVerificationStatus: 'pending',
                },
            });

            // Queue KYC review job
            await AgendaManager.runNow('kyc-review-request', {
                userId: user.id,
                documentType: dto.document_type,
                documentUrl: dto.document_url, // Raw URL sent to KYC provider in the worker
            });

            AuditLogger.log(
                actor, LogActions.AUTH_SUBMIT_ID_VERIFICATION, ResourceTypes.USER, user.id, 1,
                { documentType: dto.document_type }, ipAddress,
            );

            return { idVerificationStatus: 'pending' };
        } catch (error: any) {
            AuditLogger.log(
                actor, LogActions.AUTH_SUBMIT_ID_VERIFICATION, ResourceTypes.USER, actor.userId, 0,
                { error: error.message }, ipAddress,
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.submitIdVerification:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── handleKycWebhook ──────────────────────────────────────────────────────────

    async handleKycWebhook(
        dto: KycWebhookDTO,
        rawBody: string,
        signature: string,
        ipAddress: string,
    ): Promise<void> {
        try {
            // 1. Verify HMAC signature from KYC provider
            const signatureValid = EncryptionUtil.verifyHmacSignature(
                rawBody,
                signature,
                config.kyc.webhookSecret,
            );
            if (!signatureValid) {
                throw new ApiError('Invalid webhook signature', StatusCodes.UNAUTHORIZED);
            }

            // 2. Idempotency check — skip if already processed
            const isNew = await SessionService.markKycEventProcessed(dto.event_id);
            if (!isNew) {
                asLogger.info('KYC webhook: duplicate event ignored', { eventId: dto.event_id });
                return;
            }

            // 3. Find user
            const user = await prisma.user.findUnique({
                where: { id: dto.user_id },
                select: { id: true, email: true, displayName: true, deletedAt: true },
            });

            if (!user || user.deletedAt) {
                asLogger.warn('KYC webhook: user not found', { userId: dto.user_id });
                return;
            }

            if (dto.status === 'approved') {
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        idVerificationStatus: 'verified',
                        idVerifiedAt: new Date(),
                        idDocumentUrl: null,    // Remove document after decision
                        idDocumentIv: null,
                    },
                });

                // Queue S3 cleanup
                await AgendaManager.runNow('kyc-document-cleanup', { userId: user.id });

                // Queue approval email
                await AgendaManager.sendEmail({
                    to: user.email,
                    subject: 'Your identity has been verified',
                    template: 'kyc_approved',
                    data: { displayName: user.displayName, clientUrl: config.server.clientUrl },
                });
            } else {
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        idVerificationStatus: 'rejected',
                        idDocumentUrl: null,
                        idDocumentIv: null,
                    },
                });

                await AgendaManager.runNow('kyc-document-cleanup', { userId: user.id });

                await AgendaManager.sendEmail({
                    to: user.email,
                    subject: 'Identity verification update',
                    template: 'kyc_rejected',
                    data: {
                        displayName: user.displayName,
                        reason: dto.reason ?? 'The document could not be verified.',
                        clientUrl: config.server.clientUrl,
                    },
                });
            }

            AuditLogger.log(
                null, LogActions.AUTH_KYC_WEBHOOK, ResourceTypes.USER, user.id, 1,
                { eventId: dto.event_id, status: dto.status }, ipAddress,
            );
        } catch (error: any) {
            AuditLogger.log(
                null, LogActions.AUTH_KYC_WEBHOOK, ResourceTypes.USER, dto.user_id ?? null, 0,
                { eventId: dto.event_id, error: error.message }, ipAddress,
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('AuthService.handleKycWebhook:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
