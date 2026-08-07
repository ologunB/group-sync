import { StatusCodes } from 'http-status-codes';
import { Prisma } from '@prisma/client';
import { prisma } from '../../database/connection';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import { asLogger } from '../../shared/utils/asLogger';
import { AuditLogger, LogActions, ResourceTypes } from '../../shared/utils/audit.logger';
import { TokenPayload } from '../../shared/types/common.types';
import { StorageService } from '../../shared/storage/storage.service';
import {
    UpdateProfileDTO,
    UpdateInterestsDTO,
    SelfProfile,
    PublicProfile,
    PaginatedResult,
    MyGroupItem,
    MyApplicationItem,
    selfProfileSelect,
    publicProfileSelect,
} from './user.types';

export class UserService {
    // ── getMe ──────────────────────────────────────────────────────────────────
    // Returns the full profile of the authenticated user.
    // email and idVerificationStatus are included — self-only fields.

    async getMe(actor: TokenPayload): Promise<SelfProfile> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: actor.userId },
                select: selfProfileSelect,
            });

            if (!user) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            AuditLogger.log(
                actor,
                LogActions.USER_UPDATE_PROFILE, // reuse closest action — read has no dedicated constant yet
                ResourceTypes.USER,
                actor.userId,
                1,
                { action: 'read_self_profile' },
            );

            return user;
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('UserService.getMe:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── updateMe ───────────────────────────────────────────────────────────────
    // Updates mutable profile fields. lat/lng are converted to a PostGIS Point.
    // username uniqueness is enforced at the DB level (unique constraint) and
    // also checked here to return a human-readable error.

    async updateMe(dto: UpdateProfileDTO, actor: TokenPayload): Promise<SelfProfile> {
        try {
            // Username uniqueness pre-check (gives a friendly error before hitting the DB constraint)
            if (dto.username !== undefined && dto.username !== null) {
                const normalizedUsername = dto.username.toLowerCase();
                const taken = await prisma.user.findFirst({
                    where: {
                        username: normalizedUsername,
                        id: { not: actor.userId },
                        deletedAt: null,
                    },
                    select: { id: true },
                });
                if (taken) {
                    throw new ApiError(Messages.USERNAME_TAKEN, StatusCodes.CONFLICT);
                }
            }

            // Build the Prisma update payload — only include fields that were sent
            const updateData: Prisma.UserUpdateInput = {};

            if (dto.display_name  !== undefined) updateData.displayName        = dto.display_name.trim();
            if (dto.username      !== undefined) updateData.username           = dto.username ? dto.username.toLowerCase().trim() : null;
            if (dto.bio           !== undefined) updateData.bio                = dto.bio ? dto.bio.trim() : null;
            if (dto.city          !== undefined) updateData.city               = dto.city ? dto.city.trim() : null;
            if (dto.state         !== undefined) updateData.state              = dto.state ? dto.state.trim() : null;
            if (dto.country       !== undefined) updateData.country            = dto.country ? dto.country.trim() : null;
            if (dto.profile_photo_url !== undefined) updateData.profilePhotoUrl = dto.profile_photo_url || null;
            if (dto.preferred_language !== undefined) updateData.preferredLanguage = dto.preferred_language || null;

            // PostGIS location — only update if BOTH lat and lng are provided
            const hasLocation = dto.lat !== undefined && dto.lng !== undefined;

            if (hasLocation && Object.keys(updateData).length === 0 && !hasLocation) {
                // Nothing to update
                throw new ApiError('No fields provided to update.', StatusCodes.BAD_REQUEST);
            }

            let updatedUser: SelfProfile;

            if (hasLocation) {
                // Use raw SQL to update location as a PostGIS geometry point
                // alongside any other standard fields in a single transaction
                await prisma.$transaction(async (tx) => {
                    if (Object.keys(updateData).length > 0) {
                        await tx.user.update({
                            where: { id: actor.userId },
                            data: updateData,
                        });
                    }

                    await tx.$executeRaw`
            UPDATE users
            SET location = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326),
                updated_at = NOW()
            WHERE id = ${actor.userId}::uuid
          `;
                });

                updatedUser = await prisma.user.findUniqueOrThrow({
                    where: { id: actor.userId },
                    select: selfProfileSelect,
                });
            } else {
                if (Object.keys(updateData).length === 0) {
                    throw new ApiError('No fields provided to update.', StatusCodes.BAD_REQUEST);
                }

                updatedUser = await prisma.user.update({
                    where: { id: actor.userId },
                    data: updateData,
                    select: selfProfileSelect,
                });
            }

            AuditLogger.log(
                actor,
                LogActions.USER_UPDATE_PROFILE,
                ResourceTypes.USER,
                actor.userId,
                1,
                { updatedFields: Object.keys({ ...updateData, ...(hasLocation ? { location: true } : {}) }) },
            );

            return updatedUser;
        } catch (error: any) {
            AuditLogger.log(
                actor,
                LogActions.USER_UPDATE_PROFILE,
                ResourceTypes.USER,
                actor.userId,
                0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('UserService.updateMe:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── deleteMe ───────────────────────────────────────────────────────────────
    // Soft-deletes the authenticated user's account (GDPR compliance).
    // Sets deletedAt to now. The user record is retained but inaccessible via API.
    // All refresh tokens are revoked to force sign-out everywhere.
    //
    // Blocked while the caller is the only super_admin of a group that still has other
    // members: soft-deleting leaves the memberships row intact, so the group would keep
    // an owner who can never sign in — nobody could approve applications, post events or
    // promote a replacement, and the group would be quietly unadministrable forever.
    // Groups where they are the last member are fine; there is nobody left to strand.

    async deleteMe(actor: TokenPayload): Promise<void> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: actor.userId },
                select: { id: true, deletedAt: true },
            });

            if (!user || user.deletedAt) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            const blocking = await this.groupsBlockingDeletion(actor.userId);
            if (blocking.length > 0) {
                const names = blocking.map((g) => g.name);
                throw new ApiError(
                    `You are the only admin of ${blocking.length === 1 ? 'a group' : 'groups'} with other members (${names.join(', ')}). ` +
                    'Promote another member to admin, or remove the remaining members, before deleting your account. ' +
                    'GET /users/me/deletion-blockers lists them.',
                    StatusCodes.CONFLICT,
                    names,
                );
            }

            await prisma.$transaction(async (tx) => {
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

            AuditLogger.log(
                actor,
                LogActions.USER_DELETE_ACCOUNT,
                ResourceTypes.USER,
                actor.userId,
                1,
                {},
            );
        } catch (error: any) {
            AuditLogger.log(
                actor,
                LogActions.USER_DELETE_ACCOUNT,
                ResourceTypes.USER,
                actor.userId,
                0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('UserService.deleteMe:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Groups this user cannot walk away from: they hold the only super_admin or admin
     * seat, and somebody else is still an active member.
     *
     * Exposed so the client can show the blocker before the user commits to deleting —
     * a 409 at the final step, with no way to see which groups are at fault, is a dead
     * end. `GET /users/me/deletion-blockers` returns the same list.
     */
    async groupsBlockingDeletion(
        userId: string,
    ): Promise<{ id: string; name: string; slug: string; memberCount: number; role: string }[]> {
        const rows = await prisma.$queryRaw<
            { id: string; name: string; slug: string; member_count: number; role: string }[]
        >`
            SELECT g.id, g.name, g.slug, g.member_count, mine.role
            FROM memberships mine
            JOIN groups g ON g.id = mine.group_id
            WHERE mine.user_id = ${userId}::uuid
              AND mine.status = 'active'
              AND mine.role IN ('super_admin', 'admin')
              AND g.deleted_at IS NULL
              AND g.status != 'deleted'
              -- somebody else is still here
              AND EXISTS (
                  SELECT 1 FROM memberships other
                  WHERE other.group_id = g.id
                    AND other.user_id != ${userId}::uuid
                    AND other.status = 'active'
              )
              -- and nobody else can administer it
              AND NOT EXISTS (
                  SELECT 1 FROM memberships admins
                  WHERE admins.group_id = g.id
                    AND admins.user_id != ${userId}::uuid
                    AND admins.status = 'active'
                    AND admins.role IN ('super_admin', 'admin')
              )
            ORDER BY g.name
        `;

        return rows.map((r) => ({
            id: r.id,
            name: r.name,
            slug: r.slug,
            memberCount: Number(r.member_count),
            role: r.role,
        }));
    }

    // ── getMyGroups ────────────────────────────────────────────────────────────
    // Returns all groups the authenticated user is an active member of.
    // Includes the user's role and join date in each group.

    async getMyGroups(
        actor: TokenPayload,
        page: number,
        limit: number,
    ): Promise<PaginatedResult<MyGroupItem>> {
        try {
            const skip = (page - 1) * limit;

            const [memberships, total] = await Promise.all([
                prisma.membership.findMany({
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

                prisma.membership.count({
                    where: {
                        userId: actor.userId,
                        status: 'active',
                        group: { deletedAt: null, status: 'active' },
                    },
                }),
            ]);

            const data: MyGroupItem[] = memberships.map((m) => ({
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
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('UserService.getMyGroups:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── getMyApplications ──────────────────────────────────────────────────────
    // Returns all group applications submitted by the authenticated user.
    // Filterable by status. Paginated (offset-based).

    async getMyApplications(
        actor: TokenPayload,
        page: number,
        limit: number,
        status?: string,
    ): Promise<PaginatedResult<MyApplicationItem>> {
        try {
            const skip = (page - 1) * limit;

            const where: Prisma.ApplicationWhereInput = {
                userId: actor.userId,
                group: { deletedAt: null },
            };

            if (status) {
                where.status = status;
            }

            const [applications, total] = await Promise.all([
                prisma.application.findMany({
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

                prisma.application.count({ where }),
            ]);

            return {
                data: applications as MyApplicationItem[],
                pagination: { page, limit, total },
            };
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('UserService.getMyApplications:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── updateInterests ────────────────────────────────────────────────────────
    // Replaces the user's interest tags array entirely (not a merge/append).
    // Tags are lowercased and deduplicated before storing.

    async updateInterests(
        dto: UpdateInterestsDTO,
        actor: TokenPayload,
    ): Promise<{ interests: string[] }> {
        try {
            // Normalize: lowercase + deduplicate
            const normalized = [...new Set(dto.interests.map((t) => t.toLowerCase().trim()))].filter(
                Boolean,
            );

            const updated = await prisma.user.update({
                where: { id: actor.userId },
                data: { interests: normalized },
                select: { interests: true },
            });

            AuditLogger.log(
                actor,
                LogActions.USER_UPDATE_PROFILE,
                ResourceTypes.USER,
                actor.userId,
                1,
                { updatedFields: ['interests'], count: normalized.length },
            );

            return { interests: updated.interests };
        } catch (error: any) {
            AuditLogger.log(
                actor,
                LogActions.USER_UPDATE_PROFILE,
                ResourceTypes.USER,
                actor.userId,
                0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('UserService.updateInterests:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── getUserById ────────────────────────────────────────────────────────────
    // Returns the public profile of another user.
    // Rules:
    //   1. If caller has blocked target OR target has blocked caller → 404
    //   2. email, idVerificationStatus, phone are never included
    //   3. If user is soft-deleted or banned → 404

    async getUserById(
        targetUserId: string,
        actor: TokenPayload,
    ): Promise<PublicProfile> {
        try {
            // Block check — run both directions in parallel
            const [callerBlockedTarget, targetBlockedCaller] = await Promise.all([
                prisma.userBlock.findUnique({
                    where: {
                        blockerId_blockedId: {
                            blockerId: actor.userId,
                            blockedId: targetUserId,
                        },
                    },
                    select: { id: true },
                }),

                prisma.userBlock.findUnique({
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
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            const user = await prisma.user.findUnique({
                where: { id: targetUserId },
                select: {
                    ...publicProfileSelect,
                    deletedAt: true,
                    status: true,
                },
            });

            if (!user || user.deletedAt || user.status === 'banned') {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            // Strip internal fields before returning
            const { deletedAt: _da, status: _s, ...publicUser } = user;

            return publicUser as PublicProfile;
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('UserService.getUserById:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── blockUser ──────────────────────────────────────────────────────────────
    // Blocks another user. Idempotent — blocking an already-blocked user
    // returns success without creating a duplicate (handled by upsert).
    // Cannot block yourself.

    async blockUser(targetUserId: string, actor: TokenPayload): Promise<void> {
        try {
            if (targetUserId === actor.userId) {
                throw new ApiError('You cannot block yourself.', StatusCodes.BAD_REQUEST);
            }

            // Verify the target user exists and is not deleted
            const target = await prisma.user.findUnique({
                where: { id: targetUserId },
                select: { id: true, deletedAt: true },
            });

            if (!target || target.deletedAt) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);
            }

            // Upsert — safe to call multiple times
            await prisma.userBlock.upsert({
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

            AuditLogger.log(
                actor,
                LogActions.USER_BLOCK,
                ResourceTypes.USER,
                targetUserId,
                1,
                {},
            );
        } catch (error: any) {
            AuditLogger.log(
                actor,
                LogActions.USER_BLOCK,
                ResourceTypes.USER,
                targetUserId,
                0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('UserService.blockUser:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── unblockUser ────────────────────────────────────────────────────────────
    // Removes a block. Idempotent — unblocking a user who was never blocked
    // returns success (deleteMany instead of delete).

    async unblockUser(targetUserId: string, actor: TokenPayload): Promise<void> {
        try {
            if (targetUserId === actor.userId) {
                throw new ApiError('You cannot unblock yourself.', StatusCodes.BAD_REQUEST);
            }

            // deleteMany is idempotent — no error if the record doesn't exist
            await prisma.userBlock.deleteMany({
                where: {
                    blockerId: actor.userId,
                    blockedId: targetUserId,
                },
            });

            AuditLogger.log(
                actor,
                LogActions.USER_UNBLOCK,
                ResourceTypes.USER,
                targetUserId,
                1,
                {},
            );
        } catch (error: any) {
            AuditLogger.log(
                actor,
                LogActions.USER_UNBLOCK,
                ResourceTypes.USER,
                targetUserId,
                0,
                { error: error.message },
            );
            if (error instanceof ApiError) throw error;
            asLogger.error('UserService.unblockUser:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── uploadPhoto ────────────────────────────────────────────────────────────

    async uploadPhoto(userId: string, buffer: Buffer, mimeType: string): Promise<{ url: string }> {
        try {
            const result = await StorageService.upload(buffer, mimeType, {
                folder:   'groupsync/avatars',
                publicId: userId,
                transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto', fetch_format: 'auto' }],
            });

            await prisma.user.update({
                where: { id: userId },
                data:  { profilePhotoUrl: result.url },
            });

            return { url: result.url };
        } catch (error: any) {
            if (error instanceof ApiError) throw error;
            asLogger.error('UserService.uploadPhoto:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
