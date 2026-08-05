"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupService = void 0;
const client_1 = require("@prisma/client");
const http_status_codes_1 = require("http-status-codes");
const connection_1 = require("../../database/connection");
const error_middleware_1 = require("../../shared/middleware/error.middleware");
const response_constants_1 = require("../../shared/utils/response.constants");
const asLogger_1 = require("../../shared/utils/asLogger");
const audit_logger_1 = require("../../shared/utils/audit.logger");
const storage_service_1 = require("../../shared/storage/storage.service");
const slug_1 = require("../../shared/utils/slug");
const app_config_1 = require("../../shared/config/app.config");
const notification_dispatcher_1 = require("../notifications/notification.dispatcher");
const group_types_1 = require("./group.types");
/**
 * A group only reaches Explore once all four hold. Kept in one place because the same
 * rule is expressed twice: as SQL inside listGroups, and as TypeScript here for the
 * organiser's checklist. If they drift, organisers get told they are published while
 * nobody can find them.
 */
function isPublished(group) {
    return (group.reviewStatus === 'approved' &&
        Boolean(group.coverImageUrl) &&
        group.isDiscoverable &&
        group.status === 'active');
}
function buildPublishingChecklist(group) {
    const blockers = [];
    if (group.reviewStatus === 'pending')
        blockers.push(response_constants_1.Messages.GROUP_UNDER_REVIEW);
    if (group.reviewStatus === 'rejected') {
        blockers.push(group.reviewNotes?.trim() || 'This group was not approved for Explore.');
    }
    if (!group.coverImageUrl)
        blockers.push(response_constants_1.Messages.GROUP_COVER_REQUIRED);
    // An invite-only group opting out of discovery is a choice, not a blocker, so it is
    // reported without being framed as something to fix.
    if (!group.isDiscoverable)
        blockers.push('This group is invite-only and stays out of Explore by design.');
    return {
        reviewStatus: group.reviewStatus,
        reviewMessage: group.reviewStatus === 'pending'
            ? response_constants_1.Messages.GROUP_UNDER_REVIEW
            : group.reviewNotes?.trim() ?? null,
        hasCoverImage: Boolean(group.coverImageUrl),
        isDiscoverable: group.isDiscoverable,
        isPublished: isPublished(group),
        blockers,
    };
}
class GroupService {
    // ── createGroup ─────────────────────────────────────────────────────────────
    // Creates a group and adds the creator as super_admin in one transaction.
    // Slug is auto-generated with collision handling.
    // invite_only groups are automatically made non-discoverable.
    async createGroup(dto, actor) {
        try {
            await this.assertCreateQuota(actor.userId);
            const slug = await (0, slug_1.generateUniqueGroupSlug)(dto.name);
            // invite_only groups are hidden from discovery
            const isDiscoverable = dto.membership_type !== 'invite_only';
            const group = await connection_1.prisma.$transaction(async (tx) => {
                const newGroup = await tx.group.create({
                    data: {
                        name: dto.name.trim(),
                        slug,
                        category: dto.category.trim(),
                        subcategory: dto.subcategory?.trim() ?? null,
                        description: dto.description?.trim() ?? null,
                        city: dto.city?.trim() ?? null,
                        state: dto.state?.trim() ?? null,
                        country: dto.country?.trim() ?? 'NG',
                        membershipType: dto.membership_type ?? 'open',
                        membershipFee: dto.membership_fee ?? null,
                        membershipFeeCurrency: dto.membership_fee_currency ?? 'NGN',
                        membershipFeeFrequency: dto.membership_fee_frequency ?? null,
                        howToJoinContent: dto.how_to_join_content?.trim() ?? null,
                        rules: dto.rules?.trim() ?? null,
                        coverImageUrl: dto.cover_image_url ?? null,
                        logoUrl: dto.logo_url ?? null,
                        foundingDate: dto.founding_date ? new Date(dto.founding_date) : null,
                        isDiscoverable,
                        createdBy: actor.userId,
                    },
                    select: { id: true },
                });
                // Creator auto-joins as super_admin
                await tx.membership.create({
                    data: {
                        userId: actor.userId,
                        groupId: newGroup.id,
                        role: 'super_admin',
                        status: 'active',
                    },
                });
                return tx.group.findUniqueOrThrow({
                    where: { id: newGroup.id },
                    select: group_types_1.groupPublicSelect,
                });
            });
            // Set PostGIS location if provided
            if (dto.lat !== undefined && dto.lng !== undefined) {
                await connection_1.prisma.$executeRaw `
          UPDATE groups
          SET location = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326),
              updated_at = NOW()
          WHERE id = ${group.id}::uuid
        `;
            }
            // The group is usable immediately; it just isn't in Explore yet. Tell the
            // organiser that, and put it in front of the platform admins.
            await this.announceNewGroupForReview(group, actor.userId);
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_CREATE, audit_logger_1.ResourceTypes.GROUP, group.id, 1, { name: group.name, slug: group.slug, membershipType: group.membershipType });
            return { ...group, isActiveThisMonth: false, isPublished: isPublished(group) };
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_CREATE, audit_logger_1.ResourceTypes.GROUP, null, 0, { name: dto.name, error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('GroupService.createGroup:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── assertCreateQuota ───────────────────────────────────────────────────────
    // Caps group creation at N per rolling window per account.
    //
    // Counted from the groups table rather than a Redis counter on purpose: the limit
    // exists to stop a burst of throwaway groups, and a Redis flush must not hand
    // someone a fresh allowance. Soft-deleted groups still count — deleting one is not
    // a way to buy another attempt.
    async assertCreateQuota(userId) {
        const { maxCreatesPerWindow, createWindowDays } = app_config_1.config.groups;
        const windowStart = new Date(Date.now() - createWindowDays * 24 * 60 * 60 * 1000);
        const recentCount = await connection_1.prisma.group.count({
            where: { createdBy: userId, createdAt: { gte: windowStart } },
        });
        if (recentCount >= maxCreatesPerWindow) {
            throw new error_middleware_1.ApiError(response_constants_1.Messages.GROUP_CREATE_RATE_LIMITED(maxCreatesPerWindow, createWindowDays), http_status_codes_1.StatusCodes.TOO_MANY_REQUESTS);
        }
    }
    // ── announceNewGroupForReview ───────────────────────────────────────────────
    async announceNewGroupForReview(group, creatorId) {
        const platformAdmins = await connection_1.prisma.user.findMany({
            where: { role: { in: ['admin', 'super_admin'] }, deletedAt: null, status: 'active' },
            select: { id: true },
        });
        await Promise.all([
            notification_dispatcher_1.NotificationDispatcher.dispatch({
                userIds: [creatorId],
                type: 'system',
                title: `${group.name} is under review`,
                body: response_constants_1.Messages.GROUP_UNDER_REVIEW,
                referenceType: 'group',
                referenceId: group.id,
            }),
            platformAdmins.length > 0
                ? notification_dispatcher_1.NotificationDispatcher.dispatch({
                    userIds: platformAdmins.map((a) => a.id),
                    type: 'system',
                    title: 'New group awaiting review',
                    body: `${group.name} was submitted and is waiting for approval.`,
                    referenceType: 'group',
                    referenceId: group.id,
                })
                : Promise.resolve(),
        ]);
    }
    // ── listGroups ──────────────────────────────────────────────────────────────
    // Supports full-text search (fts_vector), PostGIS distance filter,
    // category/location/membership filters, and multiple sort modes.
    // Invite-only groups are excluded unless the caller is a member.
    async listGroups(query, actorId) {
        try {
            const page = Math.max(1, query.page ?? 1);
            const limit = Math.min(50, Math.max(1, query.limit ?? 20));
            const skip = (page - 1) * limit;
            const sort = query.sort ?? 'relevance';
            const activityWindowDays = app_config_1.config.groups.activityWindowDays;
            // Use raw SQL to support FTS + PostGIS in one query
            const conditions = [
                client_1.Prisma.sql `g.status = 'active'`,
                client_1.Prisma.sql `g.deleted_at IS NULL`,
            ];
            // Explore eligibility. Three separate rules collapse into one clause:
            //   is_discoverable   — invite-only groups opt out entirely
            //   review_status     — new groups are live but stay out of Explore until approved
            //   cover_image_url   — a group with no cover renders as an empty card
            // Members always see their own groups here regardless, so an organiser can find
            // a group that is still pending.
            const exploreEligible = client_1.Prisma.sql `
          g.is_discoverable = TRUE
          AND g.review_status = 'approved'
          AND g.cover_image_url IS NOT NULL
        `;
            if (actorId) {
                conditions.push(client_1.Prisma.sql `
          ((${exploreEligible}) OR EXISTS (
            SELECT 1 FROM memberships m
            WHERE m.group_id = g.id
              AND m.user_id = ${actorId}::uuid
              AND m.status = 'active'
          ))
        `);
            }
            else {
                conditions.push(exploreEligible);
            }
            // Full-text search (inline tsvector — no dedicated fts_vector column required)
            if (query.q?.trim()) {
                conditions.push(client_1.Prisma.sql `to_tsvector('english', g.name || ' ' || COALESCE(g.description, '') || ' ' || g.category) @@ plainto_tsquery('english', ${query.q.trim()})`);
            }
            // Category / subcategory filters
            if (query.category) {
                conditions.push(client_1.Prisma.sql `g.category ILIKE ${query.category}`);
            }
            if (query.subcategory) {
                conditions.push(client_1.Prisma.sql `g.subcategory ILIKE ${query.subcategory}`);
            }
            // Location string filters
            if (query.city)
                conditions.push(client_1.Prisma.sql `g.city    ILIKE ${query.city}`);
            if (query.state)
                conditions.push(client_1.Prisma.sql `g.state   ILIKE ${query.state}`);
            if (query.country)
                conditions.push(client_1.Prisma.sql `g.country ILIKE ${query.country}`);
            // Membership type filter
            if (query.membership_type) {
                conditions.push(client_1.Prisma.sql `g.membership_type = ${query.membership_type}`);
            }
            // Member count range
            if (query.min_members !== undefined) {
                conditions.push(client_1.Prisma.sql `g.member_count >= ${query.min_members}`);
            }
            if (query.max_members !== undefined) {
                conditions.push(client_1.Prisma.sql `g.member_count <= ${query.max_members}`);
            }
            // Verified filter
            if (query.is_verified !== undefined) {
                conditions.push(client_1.Prisma.sql `g.is_verified = ${query.is_verified}`);
            }
            // PostGIS distance filter
            const hasSpatial = query.lat !== undefined && query.lng !== undefined && query.radius_km !== undefined;
            if (hasSpatial) {
                const radiusMeters = query.radius_km * 1000;
                conditions.push(client_1.Prisma.sql `
          g.location IS NOT NULL AND
          ST_DWithin(
            g.location::geography,
            ST_MakePoint(${query.lng}, ${query.lat})::geography,
            ${radiusMeters}
          )
        `);
            }
            const whereClause = client_1.Prisma.sql `WHERE ${client_1.Prisma.join(conditions, ' AND ')}`;
            // ORDER BY clause
            let orderClause;
            if (sort === 'distance' && hasSpatial) {
                orderClause = client_1.Prisma.sql `
          ORDER BY ST_Distance(
            g.location::geography,
            ST_MakePoint(${query.lng}, ${query.lat})::geography
          ) ASC
        `;
            }
            else if (sort === 'most_members') {
                orderClause = client_1.Prisma.sql `ORDER BY g.member_count DESC`;
            }
            else if (sort === 'newest') {
                orderClause = client_1.Prisma.sql `ORDER BY g.created_at DESC`;
            }
            else if (query.q?.trim()) {
                // relevance: rank by FTS score
                orderClause = client_1.Prisma.sql `
          ORDER BY ts_rank(
            to_tsvector('english', g.name || ' ' || COALESCE(g.description, '') || ' ' || g.category),
            plainto_tsquery('english', ${query.q.trim()})
          ) DESC,
                   g.created_at DESC
        `;
            }
            else {
                orderClause = client_1.Prisma.sql `ORDER BY g.created_at DESC`;
            }
            const [groups, countResult] = await Promise.all([
                connection_1.prisma.$queryRaw `
          SELECT
            g.id, g.name, g.slug, g.category, g.subcategory, g.description,
            g.cover_image_url AS "coverImageUrl",
            g.logo_url        AS "logoUrl",
            g.city, g.state, g.country,
            g.membership_type        AS "membershipType",
            g.membership_fee         AS "membershipFee",
            g.membership_fee_currency AS "membershipFeeCurrency",
            g.membership_fee_frequency AS "membershipFeeFrequency",
            g.how_to_join_content    AS "howToJoinContent",
            g.rules,
            g.founding_date   AS "foundingDate",
            g.is_verified     AS "isVerified",
            g.is_discoverable AS "isDiscoverable",
            g.member_count    AS "memberCount",
            g.status,
            g.review_status AS "reviewStatus",
            g.created_at AS "createdAt",
            g.updated_at AS "updatedAt",
            g.created_by AS "createdBy",
            (
              g.is_discoverable = TRUE
              AND g.review_status = 'approved'
              AND g.cover_image_url IS NOT NULL
              AND g.status = 'active'
            ) AS "isPublished",
            -- Replaces the old "NEW" badge. A group is active when it has an event
            -- starting inside the activity window — a claim about what the group is
            -- doing, not about when it signed up.
            EXISTS (
              SELECT 1 FROM events e
              WHERE e.group_id = g.id
                AND e.status <> 'cancelled'
                AND e.starts_at >= NOW() - MAKE_INTERVAL(days => ${activityWindowDays})
            ) AS "isActiveThisMonth"
          FROM groups g
          ${whereClause}
          ${orderClause}
          LIMIT ${limit} OFFSET ${skip}
        `,
                connection_1.prisma.$queryRaw `
          SELECT COUNT(*) as count FROM groups g ${whereClause}
        `,
            ]);
            const total = Number(countResult[0]?.count ?? 0);
            return { data: groups, pagination: { page, limit, total } };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('GroupService.listGroups:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getGroupBySlug ──────────────────────────────────────────────────────────
    // Public profile. Invite-only groups return 404 for non-members.
    // Includes caller_membership_status when authenticated.
    async getGroupBySlug(slug, actorId) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { slug },
                select: {
                    ...group_types_1.groupPublicSelect,
                    deletedAt: true,
                    reviewNotes: true,
                },
            });
            if (!group || group.deletedAt || group.status === 'deleted') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Membership check for invite-only groups
            let callerMembership = null;
            if (actorId) {
                callerMembership = await connection_1.prisma.membership.findUnique({
                    where: { userId_groupId: { userId: actorId, groupId: group.id } },
                    select: { role: true, status: true, joinedAt: true },
                });
            }
            if (!group.isDiscoverable) {
                // invite_only: non-members get 404
                if (!callerMembership || callerMembership.status !== 'active') {
                    throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
                }
            }
            const activeEventCount = await connection_1.prisma.event.count({
                where: {
                    groupId: group.id,
                    status: { not: 'cancelled' },
                    startsAt: {
                        gte: new Date(Date.now() - app_config_1.config.groups.activityWindowDays * 24 * 60 * 60 * 1000),
                    },
                },
            });
            // Strip internal fields — reviewNotes is admin-facing copy and only ever
            // reaches the group's own admins, via the checklist below.
            const { deletedAt: _da, reviewNotes: _rn, ...publicGroup } = group;
            const isGroupAdmin = callerMembership?.status === 'active' &&
                ['super_admin', 'admin'].includes(callerMembership.role);
            return {
                group: {
                    ...publicGroup,
                    isActiveThisMonth: activeEventCount > 0,
                    isPublished: isPublished(group),
                },
                callerMembershipStatus: actorId
                    ? {
                        isMember: !!callerMembership && callerMembership.status === 'active',
                        role: callerMembership?.role ?? null,
                        status: callerMembership?.status ?? null,
                        joinedAt: callerMembership?.joinedAt ?? null,
                    }
                    : null,
                publishingChecklist: isGroupAdmin ? buildPublishingChecklist(group) : null,
            };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('GroupService.getGroupBySlug:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── updateGroup ─────────────────────────────────────────────────────────────
    // Admin or super_admin only (enforced via route middleware).
    // Changing membership_type to invite_only also sets is_discoverable = false.
    async updateGroup(groupId, dto, actor) {
        try {
            const existing = await connection_1.prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, deletedAt: true, status: true, membershipType: true },
            });
            if (!existing || existing.deletedAt || existing.status === 'deleted') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const updateData = {};
            if (dto.name !== undefined)
                updateData.name = dto.name.trim();
            if (dto.category !== undefined)
                updateData.category = dto.category.trim();
            if (dto.subcategory !== undefined)
                updateData.subcategory = dto.subcategory?.trim() ?? null;
            if (dto.description !== undefined)
                updateData.description = dto.description?.trim() ?? null;
            if (dto.city !== undefined)
                updateData.city = dto.city?.trim() ?? null;
            if (dto.state !== undefined)
                updateData.state = dto.state?.trim() ?? null;
            if (dto.country !== undefined)
                updateData.country = dto.country?.trim() ?? null;
            if (dto.membership_type !== undefined) {
                updateData.membershipType = dto.membership_type;
                // Changing to invite_only makes group non-discoverable
                if (dto.membership_type === 'invite_only') {
                    updateData.isDiscoverable = false;
                }
                else if (existing.membershipType === 'invite_only') {
                    // Changing away from invite_only restores discoverability
                    updateData.isDiscoverable = true;
                }
            }
            if (dto.membership_fee !== undefined)
                updateData.membershipFee = dto.membership_fee ?? null;
            if (dto.membership_fee_currency !== undefined)
                updateData.membershipFeeCurrency = dto.membership_fee_currency ?? null;
            if (dto.membership_fee_frequency !== undefined)
                updateData.membershipFeeFrequency = dto.membership_fee_frequency ?? null;
            if (dto.how_to_join_content !== undefined)
                updateData.howToJoinContent = dto.how_to_join_content?.trim() ?? null;
            if (dto.rules !== undefined)
                updateData.rules = dto.rules?.trim() ?? null;
            if (dto.cover_image_url !== undefined)
                updateData.coverImageUrl = dto.cover_image_url ?? null;
            if (dto.logo_url !== undefined)
                updateData.logoUrl = dto.logo_url ?? null;
            if (dto.founding_date !== undefined)
                updateData.foundingDate = dto.founding_date ? new Date(dto.founding_date) : null;
            const hasLocation = dto.lat !== undefined && dto.lng !== undefined;
            if (Object.keys(updateData).length === 0 && !hasLocation) {
                throw new error_middleware_1.ApiError('No fields provided to update.', http_status_codes_1.StatusCodes.BAD_REQUEST);
            }
            let updatedGroup;
            if (hasLocation) {
                await connection_1.prisma.$transaction(async (tx) => {
                    if (Object.keys(updateData).length > 0) {
                        await tx.group.update({ where: { id: groupId }, data: updateData });
                    }
                    await tx.$executeRaw `
            UPDATE groups
            SET location   = ST_SetSRID(ST_MakePoint(${dto.lng}, ${dto.lat}), 4326),
                updated_at = NOW()
            WHERE id = ${groupId}::uuid
          `;
                });
                updatedGroup = await connection_1.prisma.group.findUniqueOrThrow({
                    where: { id: groupId },
                    select: group_types_1.groupPublicSelect,
                });
            }
            else {
                updatedGroup = await connection_1.prisma.group.update({
                    where: { id: groupId },
                    data: updateData,
                    select: group_types_1.groupPublicSelect,
                });
            }
            // Re-generate slug if name changed
            if (dto.name) {
                const newSlug = await (0, slug_1.generateUniqueGroupSlug)(dto.name);
                await connection_1.prisma.group.update({
                    where: { id: groupId },
                    data: { slug: newSlug },
                });
                updatedGroup.slug = newSlug;
            }
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_UPDATE, audit_logger_1.ResourceTypes.GROUP, groupId, 1, { updatedFields: Object.keys(updateData) });
            return updatedGroup;
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_UPDATE, audit_logger_1.ResourceTypes.GROUP, groupId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('GroupService.updateGroup:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── deleteGroup ─────────────────────────────────────────────────────────────
    // Soft-delete only. Notifies all active members before executing.
    // Only super_admin can call this (enforced via route middleware).
    async deleteGroup(groupId, actor) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, name: true, deletedAt: true, status: true },
            });
            if (!group || group.deletedAt || group.status === 'deleted') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Read the member list before the soft-delete: dispatchToGroup would still find
            // the rows afterwards, but capturing them first keeps the recipient set exactly
            // "who was a member when it was deleted".
            const activeMembers = await connection_1.prisma.membership.findMany({
                where: { groupId, status: 'active' },
                select: { userId: true },
            });
            // Soft-delete
            await connection_1.prisma.group.update({
                where: { id: groupId },
                data: {
                    status: 'deleted',
                    deletedAt: new Date(),
                    isDiscoverable: false,
                },
            });
            await notification_dispatcher_1.NotificationDispatcher.dispatch({
                userIds: activeMembers.map((m) => m.userId).filter((id) => id !== actor.userId),
                groupId,
                type: 'group_deleted',
                title: `${group.name} was deleted`,
                body: 'A group you were a member of has been deleted by its owner.',
                referenceType: 'group',
                referenceId: groupId,
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_DELETE, audit_logger_1.ResourceTypes.GROUP, groupId, 1, { groupName: group.name, notifiedCount: activeMembers.length });
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.GROUP_DELETE, audit_logger_1.ResourceTypes.GROUP, groupId, 0, { error: error.message });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('GroupService.deleteGroup:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getGroupMembers ─────────────────────────────────────────────────────────
    // Caller must be an active member (enforced via route middleware).
    // Supports role filter and display_name search.
    async getGroupMembers(groupId, page, limit, role, search) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, deletedAt: true, status: true },
            });
            if (!group || group.deletedAt || group.status === 'deleted') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const skip = (page - 1) * limit;
            const where = {
                groupId,
                status: 'active',
            };
            if (role)
                where.role = role;
            if (search?.trim()) {
                where.user = {
                    OR: [
                        { displayName: { contains: search.trim(), mode: 'insensitive' } },
                        { username: { contains: search.trim(), mode: 'insensitive' } },
                    ],
                    deletedAt: null,
                };
            }
            const [memberships, total] = await Promise.all([
                connection_1.prisma.membership.findMany({
                    where,
                    select: {
                        userId: true,
                        role: true,
                        status: true,
                        joinedAt: true,
                        user: {
                            select: {
                                displayName: true,
                                username: true,
                                profilePhotoUrl: true,
                            },
                        },
                    },
                    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
                    skip,
                    take: limit,
                }),
                connection_1.prisma.membership.count({ where }),
            ]);
            const data = memberships.map((m) => ({
                userId: m.userId,
                displayName: m.user.displayName,
                username: m.user.username,
                profilePhotoUrl: m.user.profilePhotoUrl,
                role: m.role,
                status: m.status,
                joinedAt: m.joinedAt,
            }));
            return { data, pagination: { page, limit, total } };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('GroupService.getGroupMembers:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── getGroupStats ───────────────────────────────────────────────────────────
    // Admin only (enforced via route middleware).
    async getGroupStats(groupId, _actor) {
        try {
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, deletedAt: true, status: true, memberCount: true },
            });
            if (!group || group.deletedAt || group.status === 'deleted') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const [pendingApplications, totalApplications, upcomingEvents, messagesLast7Days] = await Promise.all([
                connection_1.prisma.application.count({ where: { groupId, status: 'pending' } }),
                connection_1.prisma.application.count({ where: { groupId } }),
                connection_1.prisma.event.count({ where: { groupId, startsAt: { gte: new Date() }, status: 'scheduled' } }),
                connection_1.prisma.message.count({ where: { groupId, createdAt: { gte: sevenDaysAgo }, isDeleted: false } }),
            ]);
            return {
                memberCount: group.memberCount,
                pendingApplications,
                totalApplications,
                upcomingEvents,
                messagesLast7Days,
            };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('GroupService.getGroupStats:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── uploadCover ────────────────────────────────────────────────────────────
    async uploadCover(groupId, buffer, mimeType) {
        try {
            const result = await storage_service_1.StorageService.upload(buffer, mimeType, {
                folder: `groupsync/groups/${groupId}`,
                publicId: 'cover',
                transformation: [{ width: 1200, height: 400, crop: 'fill', quality: 'auto', fetch_format: 'auto' }],
            });
            await connection_1.prisma.group.update({
                where: { id: groupId },
                data: { coverImageUrl: result.url },
            });
            return { url: result.url };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('GroupService.uploadCover:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── uploadLogo ─────────────────────────────────────────────────────────────
    async uploadLogo(groupId, buffer, mimeType) {
        try {
            const result = await storage_service_1.StorageService.upload(buffer, mimeType, {
                folder: `groupsync/groups/${groupId}`,
                publicId: 'logo',
                transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto', fetch_format: 'auto' }],
            });
            await connection_1.prisma.group.update({
                where: { id: groupId },
                data: { logoUrl: result.url },
            });
            return { url: result.url };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('GroupService.uploadLogo:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
exports.GroupService = GroupService;
//# sourceMappingURL=group.service.js.map