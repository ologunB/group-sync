"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authorizeGroupRole = exports.authorize = exports.authenticateVerified = exports.authenticate = void 0;
const http_status_codes_1 = require("http-status-codes");
const error_middleware_1 = require("./error.middleware");
const encryption_1 = require("../utils/encryption");
const response_constants_1 = require("../utils/response.constants");
const connection_1 = require("../../database/connection");
const asLogger_1 = require("../utils/asLogger");
// ─── authenticate ─────────────────────────────────────────────────────────────
const authenticate = async (req, _res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return next(new error_middleware_1.ApiError(response_constants_1.Messages.UNAUTHORIZED, http_status_codes_1.StatusCodes.UNAUTHORIZED));
        }
        const token = authHeader.slice(7).trim();
        if (!token) {
            return next(new error_middleware_1.ApiError(response_constants_1.Messages.UNAUTHORIZED, http_status_codes_1.StatusCodes.UNAUTHORIZED));
        }
        const payload = encryption_1.EncryptionUtil.verifyJWT(token);
        req.user = payload;
        next();
    }
    catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return next(new error_middleware_1.ApiError(response_constants_1.Messages.TOKEN_MALFORMED, http_status_codes_1.StatusCodes.UNAUTHORIZED));
        }
        if (error.name === 'TokenExpiredError') {
            return next(new error_middleware_1.ApiError(response_constants_1.Messages.TOKEN_EXPIRED, http_status_codes_1.StatusCodes.UNAUTHORIZED));
        }
        next(new error_middleware_1.ApiError(response_constants_1.Messages.UNAUTHORIZED, http_status_codes_1.StatusCodes.UNAUTHORIZED));
    }
};
exports.authenticate = authenticate;
// ─── authenticateVerified ─────────────────────────────────────────────────────
// Use on routes that require id_verification_status = 'verified'
const authenticateVerified = (req, res, next) => {
    (0, exports.authenticate)(req, res, async (err) => {
        if (err)
            return next(err);
        try {
            const user = await connection_1.prisma.user.findUnique({
                where: { id: req.user.userId },
                select: {
                    idVerificationStatus: true,
                    status: true,
                    deletedAt: true,
                },
            });
            if (!user || user.deletedAt) {
                return next(new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND));
            }
            if (user.status === 'suspended') {
                return next(new error_middleware_1.ApiError(response_constants_1.Messages.ACCOUNT_SUSPENDED, http_status_codes_1.StatusCodes.FORBIDDEN));
            }
            if (user.status === 'banned') {
                return next(new error_middleware_1.ApiError(response_constants_1.Messages.ACCOUNT_BANNED, http_status_codes_1.StatusCodes.FORBIDDEN));
            }
            if (user.idVerificationStatus !== 'verified') {
                ///todo: for now, comment out
                //  return next(new ApiError(Messages.ID_NOT_VERIFIED, StatusCodes.FORBIDDEN));
            }
            next();
        }
        catch (error) {
            asLogger_1.asLogger.error('authenticateVerified: DB check failed', error);
            next(new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR));
        }
    });
};
exports.authenticateVerified = authenticateVerified;
// ─── authorize ────────────────────────────────────────────────────────────────
// Check platform-level permissions stored in the JWT payload
const authorize = (...permissions) => {
    return (req, _res, next) => {
        if (!req.user) {
            return next(new error_middleware_1.ApiError(response_constants_1.Messages.UNAUTHORIZED, http_status_codes_1.StatusCodes.UNAUTHORIZED));
        }
        const hasAll = permissions.every((p) => req.user.permissions.includes(p));
        if (!hasAll) {
            return next(new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN));
        }
        next();
    };
};
exports.authorize = authorize;
// ─── authorizeGroupRole ───────────────────────────────────────────────────────
// Verify the caller holds one of the required roles in a specific group.
// The group ID is read from req.params.id or req.params.groupId.
// NOTE: Requires the Membership model (added in the groups module).
const authorizeGroupRole = (...roles) => {
    return async (req, _res, next) => {
        try {
            if (!req.user) {
                return next(new error_middleware_1.ApiError(response_constants_1.Messages.UNAUTHORIZED, http_status_codes_1.StatusCodes.UNAUTHORIZED));
            }
            const groupId = (req.params.id ?? req.params.groupId);
            if (!groupId) {
                return next(new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN));
            }
            const membership = await connection_1.prisma.membership.findUnique({
                where: { userId_groupId: { userId: req.user.userId, groupId } },
                select: { role: true, status: true },
            });
            if (!membership || membership.status !== 'active') {
                return next(new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN));
            }
            if (!roles.includes(membership.role)) {
                return next(new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN));
            }
            next();
        }
        catch (error) {
            asLogger_1.asLogger.error('authorizeGroupRole: error', error);
            next(new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR));
        }
    };
};
exports.authorizeGroupRole = authorizeGroupRole;
//# sourceMappingURL=auth.middleware.js.map