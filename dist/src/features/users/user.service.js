"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserService = void 0;
const http_status_codes_1 = require("http-status-codes");
const connection_1 = require("../../database/connection");
const error_middleware_1 = require("../../shared/middleware/error.middleware");
const response_constants_1 = require("../../shared/utils/response.constants");
const asLogger_1 = require("../../shared/utils/asLogger");
const audit_logger_1 = require("../../shared/utils/audit.logger");
const user_types_1 = require("./user.types");
class UserService {
    // ── getMe ──────────────────────────────────────────────────────────────────
    // Returns the full profile of the authenticated user.
    // email and idVerificationStatus are included — self-only fields.
    async getMe(actor) {
        try {
            const user = await connection_1.prisma.user.findUnique({
                where: { id: actor.userId },
                select: user_types_1.selfProfileSelect,
            });
            if (!user) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_UPDATE_PROFILE, // reuse closest action — read has no dedicated constant yet
            audit_logger_1.ResourceTypes.USER, actor.userId, 1, { action: 'read_self_profile' });
            return user;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('UserService.getMe:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── updateMe ───────────────────────────────────────────────────────────────
    // Updates mutable profile fields. lat/lng are converted to a PostGIS Point.
    // username uniqueness is enforced at the DB level (unique constraint) and
    // also checked here to return a human-readable error.
    async updateMe(dto, actor) {
        try {
            // Username uniqueness pre-check (gives a friendly error before hitting the DB constraint)
            if (dto.username !== undefined && dto.username !== null) {
                const normalizedUsername = dto.username.toLowerCase();
                const taken = await connection_1.prisma.user.findFirst({
                    where: {
                        username: normalizedUsername,
                        id: { not: actor.userId },
                        deletedAt: null,
                    },
                    select: { id: true },
                });
                if (taken) {
                    throw new error_middleware_1.ApiError(response_constants_1.Messages.USERNAME_TAKEN, http_status_codes_1.StatusCodes.CONFLICT);
                }
            }
            // Build the Prisma update payload — only include fields that were sent
            const updateData = {};
            if (dto.display_name !== undefined)
                updateData.displayName = dto.display_name.trim();
            if (dto.username !== undefined)
                updateData.username = dto.username ? dto.username.toLowerCase().trim() : null;
            if (dto.bio !== undefined)
                updateData.bio = dto.bio ? dto.bio.trim() : null;
            if (dto.city !== undefined)
                updateData.city = dto.city ? dto.city.trim() : null;
            if (dto.state !== undefined)
                updateData.state = dto.state ? dto.state.trim() : null;
            if (dto.country !== undefined)
                updateData.country = dto.country ? dto.country.trim() : null;
            if (dto.profile_photo_url !== undefined)
                updateData.profilePhotoUrl = dto.profile_photo_url || null;
            if (dto.preferred_language !== undefined)
                updateData.preferredLanguage = dto.preferred_language || null;
            // PostGIS location — only update if BOTH lat and lng are provided
            const hasLocation = dto.lat !== undefined && dto.lng !== undefined;
            if (hasLocation && Object.keys(updateData).length === 0 && !hasLocation) {
                // Nothing to update
                throw new error_middleware_1.ApiError('No fields provided to update.', http_status_codes_1.StatusCodes.BAD_REQUEST);
            }
            let updatedUser;
            if (hasLocation) {
                // Use raw SQL to update location as a PostGIS geometry point
                // alongside any other standard fields in a single transaction
                await connection_1.prisma.$transaction(async (tx) => {
                    if (Object.keys(updateData).length > 0) {
                        await tx.user.update({
                            where: { id: actor.userId },
                            data: updateData,
                        });
                    }
                    await tx.$executeRaw `
            UPDATE users
            SET location = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326),
                updated_at = NOW()
            WHERE id = ${actor.userId}::uuid
          `;
                });
                updatedUser = await connection_1.prisma.user.findUniqueOrThrow({
                    where: { id: actor.userId },
                    select: user_types_1.selfProfileSelect,
                });
            }
            else {
                if (Object.keys(updateData).length === 0) {
                    throw new error_middleware_1.ApiError('No fields provided to update.', http_status_codes_1.StatusCodes.BAD_REQUEST);
                }
                updatedUser = await connection_1.prisma.user.update({
                    where: { id: actor.userId },
                    data: updateData,
                    select: user_types_1.selfProfileSelect,
                });
            }
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_UPDATE_PROFILE, audit_logger_1.ResourceTypes.USER, actor.userId, 1, { updatedFields: Object.keys({ ...updateData, ...(hasLocation ? { location: true } : {}) }) });
            return updatedUser;
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_UPDATE_PROFILE, audit_logger_1.ResourceTypes.USER, actor.userId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('UserService.updateMe:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── deleteMe ───────────────────────────────────────────────────────────────
    // Soft-deletes the authenticated user's account (GDPR compliance).
    // Sets deletedAt to now. The user record is retained but inaccessible via API.
    // All refresh tokens are revoked to force sign-out everywhere.
    async deleteMe(actor) {
        try {
            const user = await connection_1.prisma.user.findUnique({
                where: { id: actor.userId },
                select: { id: true, deletedAt: true },
            });
            if (!user || user.deletedAt) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            await connection_1.prisma.$transaction(async (tx) => {
                // Soft-delete the user
                await tx.user.update({
                    where: { id: actor.userId },
                    data: {
                        deletedAt: new Date(),
                        status: 'banned', // prevents accidental re-activation
                        email: `deleted_${actor.userId}@deleted.groupsync`, // free up the email for re-registration
                    },
                });
                // Revoke all active refresh tokens
                await tx.refreshToken.updateMany({
                    where: { userId: actor.userId, revokedAt: null },
                    data: { revokedAt: new Date() },
                });
                // Revoke all active sessions
                await tx.session.updateMany({
                    where: { userId: actor.userId, revokedAt: null },
                    data: { revokedAt: new Date() },
                });
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_DELETE_ACCOUNT, audit_logger_1.ResourceTypes.USER, actor.userId, 1, {});
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_DELETE_ACCOUNT, audit_logger_1.ResourceTypes.USER, actor.userId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('UserService.deleteMe:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getMyGroups ────────────────────────────────────────────────────────────
    // Returns all groups the authenticated user is an active member of.
    // Includes the user's role and join date in each group.
    async getMyGroups(actor, page, limit) {
        try {
            const skip = (page - 1) * limit;
            const [memberships, total] = await Promise.all([
                connection_1.prisma.membership.findMany({
                    where: {
                        userId: actor.userId,
                        status: 'active',
                        group: { deletedAt: null, status: 'active' },
                    },
                    select: {
                        role: true,
                        status: true,
                        joinedAt: true,
                        group: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                                category: true,
                                subcategory: true,
                                coverImageUrl: true,
                                logoUrl: true,
                                city: true,
                                state: true,
                                country: true,
                                memberCount: true,
                                isVerified: true,
                                membershipType: true,
                                status: true,
                            },
                        },
                    },
                    orderBy: { joinedAt: 'desc' },
                    skip,
                    take: limit,
                }),
                connection_1.prisma.membership.count({
                    where: {
                        userId: actor.userId,
                        status: 'active',
                        group: { deletedAt: null, status: 'active' },
                    },
                }),
            ]);
            const data = memberships.map((m) => ({
                group: m.group,
                membership: {
                    role: m.role,
                    status: m.status,
                    joinedAt: m.joinedAt,
                },
            }));
            return {
                data,
                pagination: { page, limit, total },
            };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('UserService.getMyGroups:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getMyApplications ──────────────────────────────────────────────────────
    // Returns all group applications submitted by the authenticated user.
    // Filterable by status. Paginated (offset-based).
    async getMyApplications(actor, page, limit, status) {
        try {
            const skip = (page - 1) * limit;
            const where = {
                userId: actor.userId,
                group: { deletedAt: null },
            };
            if (status) {
                where.status = status;
            }
            const [applications, total] = await Promise.all([
                connection_1.prisma.application.findMany({
                    where,
                    select: {
                        id: true,
                        status: true,
                        formResponses: true,
                        rejectionReason: true,
                        submittedAt: true,
                        reviewedAt: true,
                        group: {
                            select: {
                                id: true,
                                name: true,
                                slug: true,
                                category: true,
                                coverImageUrl: true,
                                logoUrl: true,
                            },
                        },
                    },
                    orderBy: { submittedAt: 'desc' },
                    skip,
                    take: limit,
                }),
                connection_1.prisma.application.count({ where }),
            ]);
            return {
                data: applications,
                pagination: { page, limit, total },
            };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('UserService.getMyApplications:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── updateInterests ────────────────────────────────────────────────────────
    // Replaces the user's interest tags array entirely (not a merge/append).
    // Tags are lowercased and deduplicated before storing.
    async updateInterests(dto, actor) {
        try {
            // Normalize: lowercase + deduplicate
            const normalized = [...new Set(dto.interests.map((t) => t.toLowerCase().trim()))].filter(Boolean);
            const updated = await connection_1.prisma.user.update({
                where: { id: actor.userId },
                data: { interests: normalized },
                select: { interests: true },
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_UPDATE_PROFILE, audit_logger_1.ResourceTypes.USER, actor.userId, 1, { updatedFields: ['interests'], count: normalized.length });
            return { interests: updated.interests };
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_UPDATE_PROFILE, audit_logger_1.ResourceTypes.USER, actor.userId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('UserService.updateInterests:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getUserById ────────────────────────────────────────────────────────────
    // Returns the public profile of another user.
    // Rules:
    //   1. If caller has blocked target OR target has blocked caller → 404
    //   2. email, idVerificationStatus, phone are never included
    //   3. If user is soft-deleted or banned → 404
    async getUserById(targetUserId, actor) {
        try {
            // Block check — run both directions in parallel
            const [callerBlockedTarget, targetBlockedCaller] = await Promise.all([
                connection_1.prisma.userBlock.findUnique({
                    where: {
                        blockerId_blockedId: {
                            blockerId: actor.userId,
                            blockedId: targetUserId,
                        },
                    },
                    select: { id: true },
                }),
                connection_1.prisma.userBlock.findUnique({
                    where: {
                        blockerId_blockedId: {
                            blockerId: targetUserId,
                            blockedId: actor.userId,
                        },
                    },
                    select: { id: true },
                }),
            ]);
            // Return 404 in both block directions — do not reveal the block relationship
            if (callerBlockedTarget || targetBlockedCaller) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const user = await connection_1.prisma.user.findUnique({
                where: { id: targetUserId },
                select: {
                    ...user_types_1.publicProfileSelect,
                    deletedAt: true,
                    status: true,
                },
            });
            if (!user || user.deletedAt || user.status === 'banned') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Strip internal fields before returning
            const { deletedAt: _da, status: _s, ...publicUser } = user;
            return publicUser;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('UserService.getUserById:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── blockUser ──────────────────────────────────────────────────────────────
    // Blocks another user. Idempotent — blocking an already-blocked user
    // returns success without creating a duplicate (handled by upsert).
    // Cannot block yourself.
    async blockUser(targetUserId, actor) {
        try {
            if (targetUserId === actor.userId) {
                throw new error_middleware_1.ApiError('You cannot block yourself.', http_status_codes_1.StatusCodes.BAD_REQUEST);
            }
            // Verify the target user exists and is not deleted
            const target = await connection_1.prisma.user.findUnique({
                where: { id: targetUserId },
                select: { id: true, deletedAt: true },
            });
            if (!target || target.deletedAt) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Upsert — safe to call multiple times
            await connection_1.prisma.userBlock.upsert({
                where: {
                    blockerId_blockedId: {
                        blockerId: actor.userId,
                        blockedId: targetUserId,
                    },
                },
                create: {
                    blockerId: actor.userId,
                    blockedId: targetUserId,
                },
                update: {}, // already exists — no-op
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_BLOCK, audit_logger_1.ResourceTypes.USER, targetUserId, 1, {});
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_BLOCK, audit_logger_1.ResourceTypes.USER, targetUserId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('UserService.blockUser:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── unblockUser ────────────────────────────────────────────────────────────
    // Removes a block. Idempotent — unblocking a user who was never blocked
    // returns success (deleteMany instead of delete).
    async unblockUser(targetUserId, actor) {
        try {
            if (targetUserId === actor.userId) {
                throw new error_middleware_1.ApiError('You cannot unblock yourself.', http_status_codes_1.StatusCodes.BAD_REQUEST);
            }
            // deleteMany is idempotent — no error if the record doesn't exist
            await connection_1.prisma.userBlock.deleteMany({
                where: {
                    blockerId: actor.userId,
                    blockedId: targetUserId,
                },
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_UNBLOCK, audit_logger_1.ResourceTypes.USER, targetUserId, 1, {});
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.USER_UNBLOCK, audit_logger_1.ResourceTypes.USER, targetUserId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('UserService.unblockUser:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
exports.UserService = UserService;
//# sourceMappingURL=user.service.js.map