"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const crypto_1 = require("crypto");
const http_status_codes_1 = require("http-status-codes");
const google_auth_library_1 = require("google-auth-library");
const connection_1 = require("../../database/connection");
const response_constants_1 = require("../../shared/utils/response.constants");
const error_middleware_1 = require("../../shared/middleware/error.middleware");
const asLogger_1 = require("../../shared/utils/asLogger");
const audit_logger_1 = require("../../shared/utils/audit.logger");
const agenda_1 = require("../../agenda");
const session_service_1 = require("./session.service");
const app_config_1 = require("../../shared/config/app.config");
const permissions_constants_1 = require("../../shared/utils/permissions.constants");
const auth_types_1 = require("./auth.types");
const encryption_1 = require("../../shared/utils/encryption");
// ─── Google OAuth client ──────────────────────────────────────────────────────
const googleClient = new google_auth_library_1.OAuth2Client(app_config_1.config.oauth.googleClientId);
// ─── Helpers ──────────────────────────────────────────────────────────────────
const REFRESH_TOKEN_EXPIRES_MS = app_config_1.config.jwt.refreshExpiresInMs; // 30 days
function buildTokenPayload(userId, sessionId, role = 'user') {
    const permissions = (permissions_constants_1.PlatformRolePermissions[role] ?? []);
    return { userId, role, sessionId, permissions };
}
function stripSensitiveFields(user) {
    const { passwordHash: _ph, phone: _p, phoneIv: _piv, phoneHash: _phash, idDocumentUrl: _idu, idDocumentIv: _idiv, deletedAt: _da, ...safe } = user;
    return safe;
}
// ─── AuthService ──────────────────────────────────────────────────────────────
class AuthService {
    // ── register ─────────────────────────────────────────────────────────────────
    async register(dto, ipAddress) {
        const email = dto.email.toLowerCase();
        try {
            // Compute phone hash early so the uniqueness check can run in parallel
            const rawPhoneHash = dto.phone ? encryption_1.EncryptionUtil.hashPhone(dto.phone) : undefined;
            // Parallel: email uniqueness + phone uniqueness + bcrypt hash
            const [existing, phoneExists, passwordHash] = await Promise.all([
                connection_1.prisma.user.findUnique({ where: { email }, select: { id: true } }),
                rawPhoneHash
                    ? connection_1.prisma.user.findUnique({ where: { phoneHash: rawPhoneHash }, select: { id: true } })
                    : Promise.resolve(null),
                encryption_1.EncryptionUtil.hashPassword(dto.password),
            ]);
            if (existing)
                throw new error_middleware_1.ApiError(response_constants_1.Messages.EMAIL_ALREADY_EXISTS, http_status_codes_1.StatusCodes.CONFLICT);
            if (phoneExists)
                throw new error_middleware_1.ApiError('Phone number is already in use.', http_status_codes_1.StatusCodes.CONFLICT);
            // Encrypt phone fields (cheap, synchronous)
            let phone;
            let phoneIv;
            let phoneHash;
            if (dto.phone && rawPhoneHash) {
                const encrypted = encryption_1.EncryptionUtil.encryptField(dto.phone);
                phone = encrypted.ciphertext;
                phoneIv = encrypted.iv;
                phoneHash = rawPhoneHash;
            }
            const userId = (0, crypto_1.randomUUID)();
            const user = await connection_1.prisma.user.create({
                data: { id: userId, email, displayName: dto.display_name, passwordHash, phone, phoneIv, phoneHash },
                select: auth_types_1.userSafeSelect,
            });
            // Parallel: store OTP in Redis + enqueue verification email
            const otp = encryption_1.EncryptionUtil.generateOTP();
            await Promise.all([
                session_service_1.SessionService.setEmailVerificationOTP(email, otp),
                agenda_1.AgendaManager.sendEmail({
                    to: email,
                    subject: 'Verify your GroupSync email',
                    template: 'verify_email',
                    data: { displayName: user.displayName, otp, clientUrl: app_config_1.config.server.clientUrl },
                }),
            ]);
            audit_logger_1.AuditLogger.log(buildTokenPayload(userId, 'pre-verify'), audit_logger_1.LogActions.AUTH_REGISTER, audit_logger_1.ResourceTypes.USER, userId, 1, { email }, ipAddress);
            return { user };
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_REGISTER, audit_logger_1.ResourceTypes.USER, null, 0, { email, error: error.message }, ipAddress);
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.register:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── login ─────────────────────────────────────────────────────────────────────
    async login(dto, ipAddress) {
        const email = dto.email.toLowerCase();
        try {
            const rawUser = await connection_1.prisma.user.findUnique({
                where: { email },
                select: {
                    ...auth_types_1.userSafeSelect,
                    passwordHash: true,
                    deletedAt: true,
                    emailVerifiedAt: true,
                },
            });
            // Always throw the same error to prevent email enumeration
            if (!rawUser || rawUser.deletedAt) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.INVALID_CREDENTIALS, http_status_codes_1.StatusCodes.UNAUTHORIZED);
            }
            if (rawUser.status === 'suspended') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.ACCOUNT_SUSPENDED, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            if (rawUser.status === 'banned') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.ACCOUNT_BANNED, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // Lock check — must happen before password check
            const isLocked = await session_service_1.SessionService.isAccountLocked(rawUser.id);
            if (isLocked) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.ACCOUNT_LOCKED, http_status_codes_1.StatusCodes.TOO_MANY_REQUESTS);
            }
            // Password-only accounts
            if (!rawUser.passwordHash) {
                throw new error_middleware_1.ApiError('This account uses social sign-in. Please log in with your provider.', http_status_codes_1.StatusCodes.UNAUTHORIZED);
            }
            const passwordValid = await encryption_1.EncryptionUtil.comparePassword(dto.password, rawUser.passwordHash);
            if (!passwordValid) {
                const failedCount = await session_service_1.SessionService.incrementFailedLogin(rawUser.id);
                if (failedCount >= 5) {
                    audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_LOGIN, audit_logger_1.ResourceTypes.USER, rawUser.id, 0, { email, reason: 'account_locked_after_failures' }, ipAddress);
                    throw new error_middleware_1.ApiError(response_constants_1.Messages.ACCOUNT_LOCKED, http_status_codes_1.StatusCodes.TOO_MANY_REQUESTS);
                }
                throw new error_middleware_1.ApiError(response_constants_1.Messages.INVALID_CREDENTIALS, http_status_codes_1.StatusCodes.UNAUTHORIZED);
            }
            // Password is valid — now gate on email verification
            if (!rawUser.emailVerifiedAt) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.EMAIL_NOT_VERIFIED, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            const sessionId = encryption_1.EncryptionUtil.generateRandomToken(16);
            const tokenPayload = buildTokenPayload(rawUser.id, sessionId, rawUser.role);
            const tokens = encryption_1.EncryptionUtil.generateTokens(tokenPayload, ipAddress);
            const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);
            // Parallel: clear Redis failure counter + write DB session
            await Promise.all([
                session_service_1.SessionService.clearFailedLogins(rawUser.id),
                connection_1.prisma.$transaction(async (tx) => {
                    await tx.user.update({ where: { id: rawUser.id }, data: { lastLoginAt: new Date() } });
                    await tx.refreshToken.create({
                        data: { userId: rawUser.id, token: tokens.refreshToken, expiresAt: refreshExpiresAt, createdByIp: ipAddress },
                    });
                    await tx.session.create({ data: { userId: rawUser.id, ipAddress, expiresAt: refreshExpiresAt } });
                }),
            ]);
            const user = stripSensitiveFields(rawUser);
            audit_logger_1.AuditLogger.log(tokenPayload, audit_logger_1.LogActions.AUTH_LOGIN, audit_logger_1.ResourceTypes.USER, rawUser.id, 1, { email }, ipAddress);
            return { user, tokens };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.login:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── socialLogin ───────────────────────────────────────────────────────────────
    async socialLogin(dto, ipAddress) {
        try {
            let providerEmail;
            let providerId;
            let displayName;
            if (dto.provider === 'google') {
                const ticket = await googleClient.verifyIdToken({
                    idToken: dto.token,
                    audience: app_config_1.config.oauth.googleClientId,
                });
                const payload = ticket.getPayload();
                if (!payload || !payload.sub) {
                    throw new error_middleware_1.ApiError(response_constants_1.Messages.SOCIAL_TOKEN_INVALID, http_status_codes_1.StatusCodes.UNAUTHORIZED);
                }
                providerId = payload.sub;
                providerEmail = payload.email;
                displayName = payload.name ?? payload.email ?? 'User';
            }
            else {
                // Apple: requires JWK verification against Apple's public keys.
                // Implement using 'apple-signin-auth' package when Apple sign-in is required.
                throw new error_middleware_1.ApiError('Apple Sign-In is not yet configured on this server.', http_status_codes_1.StatusCodes.NOT_IMPLEMENTED);
            }
            let isNewUser = false;
            // Check if a provider link already exists
            const existingProvider = await connection_1.prisma.userProvider.findUnique({
                where: { provider_providerId: { provider: dto.provider, providerId } },
                select: { userId: true },
            });
            let userId;
            if (existingProvider) {
                // Known provider → sign in
                userId = existingProvider.userId;
            }
            else if (providerEmail) {
                // Check if an account with this email exists (link the provider)
                const existingUser = await connection_1.prisma.user.findUnique({
                    where: { email: providerEmail.toLowerCase() },
                    select: { id: true },
                });
                if (existingUser) {
                    // Link provider to an existing account
                    await connection_1.prisma.userProvider.create({
                        data: {
                            userId: existingUser.id,
                            provider: dto.provider,
                            providerId,
                            email: providerEmail.toLowerCase(),
                        },
                    });
                    userId = existingUser.id;
                }
                else {
                    // Create new user + provider link
                    isNewUser = true;
                    userId = (0, crypto_1.randomUUID)();
                    await connection_1.prisma.$transaction(async (tx) => {
                        await tx.user.create({
                            data: {
                                id: userId,
                                email: providerEmail.toLowerCase(),
                                displayName,
                            },
                        });
                        await tx.userProvider.create({
                            data: { userId, provider: dto.provider, providerId, email: providerEmail.toLowerCase() },
                        });
                    });
                }
            }
            else {
                throw new error_middleware_1.ApiError('Could not retrieve email from social provider. Please ensure email access is granted.', http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
            }
            // Fetch safe user
            const user = await connection_1.prisma.user.findUniqueOrThrow({
                where: { id: userId },
                select: auth_types_1.userSafeSelect,
            });
            const sessionId = encryption_1.EncryptionUtil.generateRandomToken(16);
            const tokenPayload = buildTokenPayload(userId, sessionId, user.role);
            const tokens = encryption_1.EncryptionUtil.generateTokens(tokenPayload, ipAddress);
            const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);
            await connection_1.prisma.$transaction(async (tx) => {
                await tx.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
                await tx.refreshToken.create({
                    data: { userId, token: tokens.refreshToken, expiresAt: refreshExpiresAt, createdByIp: ipAddress },
                });
                await tx.session.create({
                    data: { userId, ipAddress, expiresAt: refreshExpiresAt },
                });
            });
            audit_logger_1.AuditLogger.log(tokenPayload, audit_logger_1.LogActions.AUTH_SOCIAL_LOGIN, audit_logger_1.ResourceTypes.USER, userId, 1, { provider: dto.provider, isNewUser }, ipAddress);
            return { user, tokens, isNewUser };
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_SOCIAL_LOGIN, audit_logger_1.ResourceTypes.USER, null, 0, { provider: dto.provider, error: error.message }, ipAddress);
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.socialLogin:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── logout ────────────────────────────────────────────────────────────────────
    async logout(dto, actor, ipAddress) {
        try {
            // Revoke the provided refresh token
            const updated = await connection_1.prisma.refreshToken.updateMany({
                where: {
                    token: dto.refresh_token,
                    userId: actor.userId,
                    revokedAt: null,
                },
                data: { revokedAt: new Date() },
            });
            if (updated.count === 0) {
                // Token isn't found or already revoked — still return success (idempotent)
                asLogger_1.asLogger.warn('AuthService.logout: refresh token not found or already revoked', {
                    userId: actor.userId,
                });
            }
            // Revoke the active session associated with this sessionId
            await connection_1.prisma.session.updateMany({
                where: { userId: actor.userId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
            await session_service_1.SessionService.clearPresence(actor.userId);
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.AUTH_LOGOUT, audit_logger_1.ResourceTypes.SESSION, actor.userId, 1, {}, ipAddress);
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.AUTH_LOGOUT, audit_logger_1.ResourceTypes.SESSION, actor.userId, 0, { error: error.message }, ipAddress);
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.logout:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── refresh ───────────────────────────────────────────────────────────────────
    async refresh(dto, ipAddress) {
        try {
            const existing = await connection_1.prisma.refreshToken.findUnique({
                where: { token: dto.refresh_token },
                include: { user: { select: { id: true, status: true, role: true, deletedAt: true } } },
            });
            if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.REFRESH_TOKEN_INVALID, http_status_codes_1.StatusCodes.UNAUTHORIZED);
            }
            if (existing.user.deletedAt || existing.user.status === 'banned') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.ACCOUNT_BANNED, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            if (existing.user.status === 'suspended') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.ACCOUNT_SUSPENDED, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            const sessionId = encryption_1.EncryptionUtil.generateRandomToken(16);
            const tokenPayload = buildTokenPayload(existing.userId, sessionId, existing.user.role);
            const tokens = encryption_1.EncryptionUtil.generateTokens(tokenPayload, ipAddress);
            const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);
            // Rotate: revoke an old token, issue a new one (atomic)
            await connection_1.prisma.$transaction(async (tx) => {
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
            audit_logger_1.AuditLogger.log(tokenPayload, audit_logger_1.LogActions.AUTH_REFRESH_TOKEN, audit_logger_1.ResourceTypes.REFRESH_TOKEN, existing.userId, 1, {}, ipAddress);
            return tokens;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.refresh:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── forgotPassword ────────────────────────────────────────────────────────────
    async forgotPassword(dto, ipAddress) {
        const email = dto.email.toLowerCase();
        try {
            // Look up user — but always return the same response to prevent email enumeration
            const user = await connection_1.prisma.user.findUnique({
                where: { email },
                select: { id: true, displayName: true, deletedAt: true },
            });
            if (user && !user.deletedAt) {
                const otp = encryption_1.EncryptionUtil.generateOTP();
                await session_service_1.SessionService.setForgotPasswordOTP(email, otp);
                await agenda_1.AgendaManager.sendEmail({
                    to: email,
                    subject: 'Reset your GroupSync password',
                    template: 'forgot_password',
                    data: { displayName: user.displayName, otp, clientUrl: app_config_1.config.server.clientUrl },
                });
                audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_FORGOT_PASSWORD, audit_logger_1.ResourceTypes.USER, user.id, 1, { email }, ipAddress);
            }
            // If user not found, we still return success (no-op) — no audit failure log
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.forgotPassword:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    async verifyForgotOtp(dto, ipAddress) {
        const email = dto.email.toLowerCase();
        try {
            const storedOtp = await session_service_1.SessionService.getForgotPasswordOTP(email);
            if (!storedOtp || storedOtp !== dto.otp) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.INVALID_VERIFICATION_CODE, http_status_codes_1.StatusCodes.BAD_REQUEST);
            }
            // OTP is valid — do NOT delete it here, so resetPassword can still consume it
            audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_FORGOT_PASSWORD, audit_logger_1.ResourceTypes.USER, null, 1, { email, step: 'otp_verified' }, ipAddress);
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_FORGOT_PASSWORD, audit_logger_1.ResourceTypes.USER, null, 0, { email, step: 'otp_verify_failed', error: error.message }, ipAddress);
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.verifyForgotOtp:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── resetPassword ─────────────────────────────────────────────────────────────
    async resetPassword(dto, ipAddress) {
        const email = dto.email.toLowerCase();
        try {
            const storedOtp = await session_service_1.SessionService.getForgotPasswordOTP(email);
            if (!storedOtp || storedOtp !== dto.otp) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.INVALID_VERIFICATION_CODE, http_status_codes_1.StatusCodes.BAD_REQUEST);
            }
            const user = await connection_1.prisma.user.findUnique({
                where: { email },
                select: { id: true, deletedAt: true },
            });
            if (!user || user.deletedAt) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const passwordHash = await encryption_1.EncryptionUtil.hashPassword(dto.password);
            // Reset password + revoke all refresh tokens (force re-login everywhere)
            await connection_1.prisma.$transaction(async (tx) => {
                await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
                await tx.refreshToken.updateMany({
                    where: { userId: user.id, revokedAt: null },
                    data: { revokedAt: new Date() },
                });
            });
            await session_service_1.SessionService.deleteForgotPasswordOTP(email);
            await session_service_1.SessionService.clearFailedLogins(user.id);
            audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_RESET_PASSWORD, audit_logger_1.ResourceTypes.USER, user.id, 1, { email }, ipAddress);
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_RESET_PASSWORD, audit_logger_1.ResourceTypes.USER, null, 0, { email, error: error.message }, ipAddress);
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.resetPassword:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── changePassword ────────────────────────────────────────────────────────────
    async changePassword(dto, actor, ipAddress) {
        try {
            const user = await connection_1.prisma.user.findUnique({
                where: { id: actor.userId },
                select: { id: true, passwordHash: true, deletedAt: true },
            });
            if (!user || user.deletedAt) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (!user.passwordHash) {
                throw new error_middleware_1.ApiError('This account uses social sign-in and has no password to change.', http_status_codes_1.StatusCodes.BAD_REQUEST);
            }
            const oldPasswordValid = await encryption_1.EncryptionUtil.comparePassword(dto.old_password, user.passwordHash);
            if (!oldPasswordValid) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.INCORRECT_OLD_PASSWORD, http_status_codes_1.StatusCodes.BAD_REQUEST);
            }
            const newPasswordHash = await encryption_1.EncryptionUtil.hashPassword(dto.new_password);
            await connection_1.prisma.user.update({
                where: { id: user.id },
                data: { passwordHash: newPasswordHash },
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.AUTH_CHANGE_PASSWORD, audit_logger_1.ResourceTypes.USER, user.id, 1, {}, ipAddress);
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.AUTH_CHANGE_PASSWORD, audit_logger_1.ResourceTypes.USER, actor.userId, 0, { error: error.message }, ipAddress);
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.changePassword:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── verifyEmail ───────────────────────────────────────────────────────────────
    async verifyEmail(dto, ipAddress) {
        const email = dto.email.toLowerCase();
        try {
            const storedOtp = await session_service_1.SessionService.getEmailVerificationOTP(email);
            if (!storedOtp || storedOtp !== dto.otp) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.INVALID_VERIFICATION_CODE, http_status_codes_1.StatusCodes.BAD_REQUEST);
            }
            const rawUser = await connection_1.prisma.user.findUnique({
                where: { email },
                select: { ...auth_types_1.userSafeSelect, deletedAt: true },
            });
            if (!rawUser || rawUser.deletedAt) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const sessionId = encryption_1.EncryptionUtil.generateRandomToken(16);
            const tokenPayload = buildTokenPayload(rawUser.id, sessionId, rawUser.role);
            const tokens = encryption_1.EncryptionUtil.generateTokens(tokenPayload, ipAddress);
            const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRES_MS);
            const user = await connection_1.prisma.$transaction(async (tx) => {
                const updated = await tx.user.update({
                    where: { id: rawUser.id },
                    data: { emailVerifiedAt: new Date() },
                    select: auth_types_1.userSafeSelect,
                });
                await tx.refreshToken.create({
                    data: { userId: rawUser.id, token: tokens.refreshToken, expiresAt: refreshExpiresAt, createdByIp: ipAddress },
                });
                await tx.session.create({ data: { userId: rawUser.id, ipAddress, expiresAt: refreshExpiresAt } });
                return updated;
            });
            await session_service_1.SessionService.deleteEmailVerificationOTP(email);
            // Queue welcome email
            await agenda_1.AgendaManager.sendEmail({
                to: email,
                subject: 'Welcome to GroupSync!',
                template: 'welcome',
                data: { displayName: user.displayName, clientUrl: app_config_1.config.server.clientUrl },
            });
            audit_logger_1.AuditLogger.log(tokenPayload, audit_logger_1.LogActions.AUTH_VERIFY_EMAIL, audit_logger_1.ResourceTypes.USER, user.id, 1, { email }, ipAddress);
            return { user, tokens };
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_VERIFY_EMAIL, audit_logger_1.ResourceTypes.USER, null, 0, { email, error: error.message }, ipAddress);
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.verifyEmail:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── resendVerification ────────────────────────────────────────────────────────
    async resendVerification(dto, ipAddress) {
        const email = dto.email.toLowerCase();
        try {
            const user = await connection_1.prisma.user.findUnique({
                where: { email },
                select: { id: true, displayName: true, emailVerifiedAt: true, deletedAt: true },
            });
            // Always return success — prevents email enumeration
            if (!user || user.deletedAt)
                return;
            if (user.emailVerifiedAt) {
                // Already verified — silently succeed, no harm
                return;
            }
            const otp = encryption_1.EncryptionUtil.generateOTP();
            await session_service_1.SessionService.setEmailVerificationOTP(email, otp);
            await agenda_1.AgendaManager.sendEmail({
                to: email,
                subject: 'Your GroupSync verification code',
                template: 'verify_email',
                data: { displayName: user.displayName, otp, clientUrl: app_config_1.config.server.clientUrl },
            });
            audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_RESEND_VERIFICATION, audit_logger_1.ResourceTypes.USER, user.id, 1, { email }, ipAddress);
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.resendVerification:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── submitIdVerification ──────────────────────────────────────────────────────
    async submitIdVerification(dto, actor, ipAddress) {
        try {
            const user = await connection_1.prisma.user.findUnique({
                where: { id: actor.userId },
                select: { id: true, idVerificationStatus: true, deletedAt: true },
            });
            if (!user || user.deletedAt) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (user.idVerificationStatus === 'verified') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.KYC_ALREADY_VERIFIED, http_status_codes_1.StatusCodes.CONFLICT);
            }
            if (user.idVerificationStatus === 'pending') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.KYC_ALREADY_SUBMITTED, http_status_codes_1.StatusCodes.CONFLICT);
            }
            // Encrypt the document URL before storing
            const encrypted = encryption_1.EncryptionUtil.encryptField(dto.document_url);
            await connection_1.prisma.user.update({
                where: { id: user.id },
                data: {
                    idDocumentUrl: encrypted.ciphertext,
                    idDocumentIv: encrypted.iv,
                    idVerificationStatus: 'pending',
                },
            });
            // Queue KYC review job
            await agenda_1.AgendaManager.runNow('kyc-review-request', {
                userId: user.id,
                documentType: dto.document_type,
                documentUrl: dto.document_url, // Raw URL sent to KYC provider in the worker
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.AUTH_SUBMIT_ID_VERIFICATION, audit_logger_1.ResourceTypes.USER, user.id, 1, { documentType: dto.document_type }, ipAddress);
            return { idVerificationStatus: 'pending' };
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.AUTH_SUBMIT_ID_VERIFICATION, audit_logger_1.ResourceTypes.USER, actor.userId, 0, { error: error.message }, ipAddress);
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.submitIdVerification:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── handleKycWebhook ──────────────────────────────────────────────────────────
    async handleKycWebhook(dto, rawBody, signature, ipAddress) {
        try {
            // 1. Verify HMAC signature from KYC provider
            const signatureValid = encryption_1.EncryptionUtil.verifyHmacSignature(rawBody, signature, app_config_1.config.kyc.webhookSecret);
            if (!signatureValid) {
                throw new error_middleware_1.ApiError('Invalid webhook signature', http_status_codes_1.StatusCodes.UNAUTHORIZED);
            }
            // 2. Idempotency check — skip if already processed
            const isNew = await session_service_1.SessionService.markKycEventProcessed(dto.event_id);
            if (!isNew) {
                asLogger_1.asLogger.info('KYC webhook: duplicate event ignored', { eventId: dto.event_id });
                return;
            }
            // 3. Find user
            const user = await connection_1.prisma.user.findUnique({
                where: { id: dto.user_id },
                select: { id: true, email: true, displayName: true, deletedAt: true },
            });
            if (!user || user.deletedAt) {
                asLogger_1.asLogger.warn('KYC webhook: user not found', { userId: dto.user_id });
                return;
            }
            if (dto.status === 'approved') {
                await connection_1.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        idVerificationStatus: 'verified',
                        idVerifiedAt: new Date(),
                        idDocumentUrl: null, // Remove document after decision
                        idDocumentIv: null,
                    },
                });
                // Queue S3 cleanup
                await agenda_1.AgendaManager.runNow('kyc-document-cleanup', { userId: user.id });
                // Queue approval email
                await agenda_1.AgendaManager.sendEmail({
                    to: user.email,
                    subject: 'Your identity has been verified',
                    template: 'kyc_approved',
                    data: { displayName: user.displayName, clientUrl: app_config_1.config.server.clientUrl },
                });
            }
            else {
                await connection_1.prisma.user.update({
                    where: { id: user.id },
                    data: {
                        idVerificationStatus: 'rejected',
                        idDocumentUrl: null,
                        idDocumentIv: null,
                    },
                });
                await agenda_1.AgendaManager.runNow('kyc-document-cleanup', { userId: user.id });
                await agenda_1.AgendaManager.sendEmail({
                    to: user.email,
                    subject: 'Identity verification update',
                    template: 'kyc_rejected',
                    data: {
                        displayName: user.displayName,
                        reason: dto.reason ?? 'The document could not be verified.',
                        clientUrl: app_config_1.config.server.clientUrl,
                    },
                });
            }
            audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_KYC_WEBHOOK, audit_logger_1.ResourceTypes.USER, user.id, 1, { eventId: dto.event_id, status: dto.status }, ipAddress);
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(null, audit_logger_1.LogActions.AUTH_KYC_WEBHOOK, audit_logger_1.ResourceTypes.USER, dto.user_id ?? null, 0, { eventId: dto.event_id, error: error.message }, ipAddress);
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AuthService.handleKycWebhook:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
exports.AuthService = AuthService;
//# sourceMappingURL=auth.service.js.map