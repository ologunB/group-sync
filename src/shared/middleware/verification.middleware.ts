import { Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ApiError } from './error.middleware';
import { Messages } from '../utils/response.constants';
import { asLogger } from '../utils/asLogger';
import { prisma } from '../../database/connection';
import { AuthenticatedRequest, authenticate } from './auth.middleware';

/**
 * The verification ladder. Each rung buys a wider capability, so the friction only
 * lands on the users asking for the riskier thing:
 *
 *   tier 1 — email + phone OTP      browse, join public groups, RSVP to events
 *   tier 2 — tier 1 + bio, then a   create a group  (approval is the review queue in
 *            platform admin review                   GroupService/AdminService, not here)
 *   tier 3 — tier 2 + verified ID   host an event at a physical address
 *
 * Tier 3 is enforced inside EventService rather than as route middleware, because it
 * only applies when the request actually carries a street address.
 */

interface VerificationSnapshot {
    status: string;
    deletedAt: Date | null;
    emailVerifiedAt: Date | null;
    phoneVerifiedAt: Date | null;
    idVerificationStatus: string;
    bio: string | null;
}

async function loadUser(userId: string): Promise<VerificationSnapshot | null> {
    return prisma.user.findUnique({
        where: { id: userId },
        select: {
            status: true,
            deletedAt: true,
            emailVerifiedAt: true,
            phoneVerifiedAt: true,
            idVerificationStatus: true,
            bio: true,
        },
    });
}

/** Shared account-health checks that every tier applies before its own rule. */
function assertAccountUsable(user: VerificationSnapshot | null): ApiError | null {
    if (!user || user.deletedAt) {
        return new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
    }
    if (user.status === 'suspended') {
        return new ApiError(Messages.ACCOUNT_SUSPENDED, StatusCodes.FORBIDDEN);
    }
    if (user.status === 'banned') {
        return new ApiError(Messages.ACCOUNT_BANNED, StatusCodes.FORBIDDEN);
    }
    return null;
}

function buildGate(
    check: (user: VerificationSnapshot) => ApiError | null,
): (req: AuthenticatedRequest, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
        authenticate(req, res, async (err?: unknown) => {
            if (err) return next(err);

            try {
                const user = await loadUser(req.user!.userId);

                const accountError = assertAccountUsable(user);
                if (accountError) return next(accountError);

                const gateError = check(user!);
                if (gateError) return next(gateError);

                next();
            } catch (error) {
                asLogger.error('verification middleware: DB check failed', error);
                next(new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR));
            }
        });
    };
}

/**
 * Tier 1 — email + phone verified. Guards joining groups, applying, RSVPing and
 * anything else that puts the account in front of other members.
 */
export const authenticateContactVerified = buildGate((user) => {
    if (!user.emailVerifiedAt) {
        return new ApiError(Messages.EMAIL_NOT_VERIFIED, StatusCodes.FORBIDDEN);
    }
    if (!user.phoneVerifiedAt) {
        return new ApiError(Messages.PHONE_NOT_VERIFIED, StatusCodes.FORBIDDEN);
    }
    return null;
});

/**
 * Tier 2 — tier 1 plus a bio. Guards group creation. The manual-approval half of tier 2
 * is the review queue: the group is created immediately but stays out of Explore until
 * a platform admin approves it.
 */
export const authenticateOrganiser = buildGate((user) => {
    if (!user.emailVerifiedAt) {
        return new ApiError(Messages.EMAIL_NOT_VERIFIED, StatusCodes.FORBIDDEN);
    }
    if (!user.phoneVerifiedAt) {
        return new ApiError(Messages.PHONE_NOT_VERIFIED, StatusCodes.FORBIDDEN);
    }
    if (!user.bio?.trim()) {
        return new ApiError(Messages.BIO_REQUIRED_FOR_GROUP, StatusCodes.FORBIDDEN);
    }
    return null;
});

/** Tier 3 predicate, used by EventService when a request carries a street address. */
export async function hasVerifiedId(userId: string): Promise<boolean> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { idVerificationStatus: true },
    });
    return user?.idVerificationStatus === 'verified';
}
