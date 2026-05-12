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
    AuthResult,
    RegisterResult,
    TokenPair,
    SafeUser,
    userSafeSelect, VerifyForgotOtpDTO,
} from './auth.types';
import {EncryptionUtil} from "../../shared/utils/encryption";

// ─── Google OAuth client ──────────────────────────────────────────────────────

const googleClient = new OAuth2Client(config.oauth.googleClientId);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const REFRESH_TOKEN_EXPIRES_MS = config.jwt.refreshExpiresInMs; // 30 days

function buildTokenPayload(userId: string, sessionId: string, role: string = 'user'): TokenPayload {
    const permissions = (PlatformRolePermissions[role] ?? []) as string[];
    return { userId, role, sessionId, permissions };
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
                data: { id: userId, email, displayName: dto.display_name, passwordHash, phone, phoneIv, phoneHash },
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

            if (dto.provider === 'google') {
                const ticket = await googleClient.verifyIdToken({
                    idToken: dto.token,
                    audience: config.oauth.googleClientId,
                });
                const payload = ticket.getPayload();
                if (!payload || !payload.sub) {
                    throw new ApiError(Messages.SOCIAL_TOKEN_INVALID, StatusCodes.UNAUTHORIZED);
                }
                providerId = payload.sub;
                providerEmail = payload.email;
                displayName = payload.name ?? payload.email ?? 'User';
            } else {
                // Apple: requires JWK verification against Apple's public keys.
                // Implement using 'apple-signin-auth' package when Apple sign-in is required.
                throw new ApiError(
                    'Apple Sign-In is not yet configured on this server.',
                    StatusCodes.NOT_IMPLEMENTED,
                );
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
                    select: { id: true },
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
                } else {
                    // Create new user + provider link
                    isNewUser = true;
                    userId = randomUUID();

                    await prisma.$transaction(async (tx) => {
                        await tx.user.create({
                            data: {
                                id: userId,
                                email: providerEmail!.toLowerCase(),
                                displayName,
                            },
                        });
                        await tx.userProvider.create({
                            data: { userId, provider: dto.provider, providerId, email: providerEmail!.toLowerCase() },
                        });
                    });
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

            await prisma.$transaction(async (tx) => {
                await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
                await tx.refreshToken.create({
                    data: { userId, token: tokens.refreshToken, expiresAt: refreshExpiresAt, createdByIp: ipAddress },
                });
                await tx.session.create({
                    data: { userId, ipAddress, expiresAt: refreshExpiresAt },
                });
            });

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
