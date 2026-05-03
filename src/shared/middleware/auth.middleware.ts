import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from './error.middleware';
import { EncryptionUtil } from '../utils/encryption';
import { Messages } from '../utils/response.constants';
import { TokenPayload } from '../types/common.types';
import { prisma } from '../../database/connection';
import { asLogger } from '../utils/asLogger';

// ─── Augmented request type ───────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
    user?: TokenPayload;
}

// ─── authenticate ─────────────────────────────────────────────────────────────

export const authenticate = async (
    req: AuthenticatedRequest,
    _res: Response,
    next: NextFunction,
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            return next(new ApiError(Messages.UNAUTHORIZED, StatusCodes.UNAUTHORIZED));
        }

        const token = authHeader.slice(7).trim();
        if (!token) {
            return next(new ApiError(Messages.UNAUTHORIZED, StatusCodes.UNAUTHORIZED));
        }

        const payload = EncryptionUtil.verifyJWT(token);
        req.user = payload;
        next();
    } catch (error: any) {
        if (error.name === 'JsonWebTokenError') {
            return next(new ApiError(Messages.TOKEN_MALFORMED, StatusCodes.UNAUTHORIZED));
        }
        if (error.name === 'TokenExpiredError') {
            return next(new ApiError(Messages.TOKEN_EXPIRED, StatusCodes.UNAUTHORIZED));
        }
        next(new ApiError(Messages.UNAUTHORIZED, StatusCodes.UNAUTHORIZED));
    }
};

// ─── authenticateVerified ─────────────────────────────────────────────────────
// Use on routes that require id_verification_status = 'verified'

export const authenticateVerified = (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): void => {
    authenticate(req, res, async (err?: unknown) => {
        if (err) return next(err);

        try {
            const user = await prisma.user.findUnique({
                where: { id: req.user!.userId },
                select: {
                    idVerificationStatus: true,
                    status: true,
                    deletedAt: true,
                },
            });

            if (!user || user.deletedAt) {
                return next(new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND));
            }

            if (user.status === 'suspended') {
                return next(new ApiError(Messages.ACCOUNT_SUSPENDED, StatusCodes.FORBIDDEN));
            }

            if (user.status === 'banned') {
                return next(new ApiError(Messages.ACCOUNT_BANNED, StatusCodes.FORBIDDEN));
            }

            if (user.idVerificationStatus !== 'verified') {
                return next(new ApiError(Messages.ID_NOT_VERIFIED, StatusCodes.FORBIDDEN));
            }

            next();
        } catch (error) {
            asLogger.error('authenticateVerified: DB check failed', error);
            next(new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
        }
    });
};

// ─── authorize ────────────────────────────────────────────────────────────────
// Check platform-level permissions stored in the JWT payload

export const authorize = (...permissions: string[]) => {
    return (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
        if (!req.user) {
            return next(new ApiError(Messages.UNAUTHORIZED, StatusCodes.UNAUTHORIZED));
        }

        const hasAll = permissions.every((p) => req.user!.permissions.includes(p));
        if (!hasAll) {
            return next(new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN));
        }

        next();
    };
};

// ─── authorizeGroupRole ───────────────────────────────────────────────────────
// Verify the caller holds one of the required roles in a specific group.
// The group ID is read from req.params.id or req.params.groupId.
// NOTE: Requires the Membership model (added in the groups module).

export const authorizeGroupRole = (...roles: string[]) => {
    return async (
        req: AuthenticatedRequest,
        _res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            if (!req.user) {
                return next(new ApiError(Messages.UNAUTHORIZED, StatusCodes.UNAUTHORIZED));
            }

            const groupId = (req.params.id ?? req.params.groupId) as string | undefined;
            if (!groupId) {
                return next(new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN));
            }

            // prisma.membership is available once prisma/schemas/group.prisma is added
            const membership = await (prisma as any).membership.findUnique({
                where: { userId_groupId: { userId: req.user.userId, groupId } },
                select: { role: true, status: true },
            });

            if (!membership || membership.status !== 'active') {
                return next(new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN));
            }

            if (!roles.includes(membership.role as string)) {
                return next(new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN));
            }

            next();
        } catch (error) {
            asLogger.error('authorizeGroupRole: error', error);
            next(new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
        }
    };
};
