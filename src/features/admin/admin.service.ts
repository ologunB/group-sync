import { Prisma } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../database/connection';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import { asLogger } from '../../shared/utils/asLogger';
import { AuditLogger, LogActions, ResourceTypes } from '../../shared/utils/audit.logger';
import { TokenPayload, PaginationMeta } from '../../shared/types/common.types';
import { config } from '../../shared/config/app.config';
import { NotificationDispatcher } from '../notifications/notification.dispatcher';
import {
    AdminListUsersQuery,
    AdminUpdateUserDTO,
    AdminVerifyIdDTO,
    AdminListGroupsQuery,
    AdminUpdateGroupDTO,
    AdminListReportsQuery,
    AdminResolveReportDTO,
    AdminListAuditLogsQuery,
    AdminChangeRoleDTO,
    AdminReviewGroupDTO,
    PendingGroupItem,
    PlatformStats,
    adminUserSelect,
    adminGroupSelect,
    adminPendingGroupSelect,
    adminReportSelect,
    adminAuditSelect,
    AdminListTaxonomyQuery,
    AdminCreateCategoryDTO,
    AdminUpdateCategoryDTO,
    AdminCreateInterestDTO,
    AdminUpdateInterestDTO,
    AdminListEventsQuery,
    AdminCancelEventDTO,
    adminCategorySelect,
    adminInterestSelect,
    adminEventSelect,
} from './admin.types';

export class AdminService {
    // ── Users ─────────────────────────────────────────────────────────────────

    async listUsers(q: AdminListUsersQuery): Promise<{ data: unknown[]; pagination: PaginationMeta }> {
        try {
            const page = Math.max(q.page ?? 1, 1);
            const limit = Math.min(q.limit ?? 20, 100);
            const skip = (page - 1) * limit;

            const where: Prisma.UserWhereInput = { deletedAt: null };
            if (q.status) where.status = q.status;
            if (q.search) {
                where.OR = [
                    { displayName: { contains: q.search, mode: 'insensitive' } },
                    { email: { contains: q.search, mode: 'insensitive' } },
                    { username: { contains: q.search, mode: 'insensitive' } },
                ];
            }

            const [data, total] = await Promise.all([
                prisma.user.findMany({ where, select: adminUserSelect, skip, take: limit, orderBy: { createdAt: 'desc' } }),
                prisma.user.count({ where }),
            ]);

            return { data, pagination: { page, limit, total } };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.listUsers error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async updateUserStatus(userId: string, dto: AdminUpdateUserDTO, actor: TokenPayload): Promise<unknown> {
        try {
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
            if (!user) throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);

            const updated = await prisma.user.update({
                where: { id: userId },
                data: { status: dto.status },
                select: adminUserSelect,
            });

            AuditLogger.log(actor, LogActions.ADMIN_USER_UPDATE, ResourceTypes.USER, userId, 1, { status: dto.status });

            return updated;
        } catch (error) {
            AuditLogger.log(actor, LogActions.ADMIN_USER_UPDATE, ResourceTypes.USER, userId, 0, { error });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.updateUserStatus error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async getUserVerification(userId: string): Promise<unknown> {
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    displayName: true,
                    email: true,
                    idVerificationStatus: true,
                    idDocumentUrl: true,
                    idDocumentIv: true,
                    idVerifiedAt: true,
                },
            });

            if (!user) throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);

            return user;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.getUserVerification error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async reviewIdVerification(userId: string, dto: AdminVerifyIdDTO, actor: TokenPayload): Promise<unknown> {
        try {
            const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
            if (!user) throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);

            const newStatus = dto.decision === 'approved' ? 'verified' : 'rejected';

            const updated = await prisma.user.update({
                where: { id: userId },
                data: {
                    idVerificationStatus: newStatus,
                    idVerifiedAt: dto.decision === 'approved' ? new Date() : null,
                    // Clear document after decision
                    idDocumentUrl: null,
                    idDocumentIv: null,
                },
                select: adminUserSelect,
            });

            AuditLogger.log(actor, LogActions.ADMIN_USER_VERIFY_ID, ResourceTypes.USER, userId, 1, {
                decision: dto.decision,
                rejection_reason: dto.rejection_reason,
            });

            return updated;
        } catch (error) {
            AuditLogger.log(actor, LogActions.ADMIN_USER_VERIFY_ID, ResourceTypes.USER, userId, 0, { error });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.reviewIdVerification error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Groups ────────────────────────────────────────────────────────────────

    async listGroups(q: AdminListGroupsQuery): Promise<{ data: unknown[]; pagination: PaginationMeta }> {
        try {
            const page = Math.max(q.page ?? 1, 1);
            const limit = Math.min(q.limit ?? 20, 100);
            const skip = (page - 1) * limit;

            const where: Prisma.GroupWhereInput = {};
            if (q.status) where.status = q.status;
            if (q.review_status) where.reviewStatus = q.review_status;
            if (q.search) {
                where.OR = [
                    { name: { contains: q.search, mode: 'insensitive' } },
                    { slug: { contains: q.search, mode: 'insensitive' } },
                ];
            }

            const [data, total] = await Promise.all([
                prisma.group.findMany({ where, select: adminGroupSelect, skip, take: limit, orderBy: { createdAt: 'desc' } }),
                prisma.group.count({ where }),
            ]);

            return { data, pagination: { page, limit, total } };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.listGroups error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async updateGroup(groupId: string, dto: AdminUpdateGroupDTO, actor: TokenPayload): Promise<unknown> {
        try {
            const group = await prisma.group.findUnique({ where: { id: groupId }, select: { id: true } });
            if (!group) throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);

            const updated = await prisma.group.update({
                where: { id: groupId },
                data: {
                    ...(dto.status !== undefined && { status: dto.status }),
                    ...(dto.is_verified !== undefined && { isVerified: dto.is_verified }),
                },
                select: adminGroupSelect,
            });

            AuditLogger.log(actor, LogActions.ADMIN_GROUP_UPDATE, ResourceTypes.GROUP, groupId, 1, dto as Record<string, unknown>);

            return updated;
        } catch (error) {
            AuditLogger.log(actor, LogActions.ADMIN_GROUP_UPDATE, ResourceTypes.GROUP, groupId, 0, { error });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.updateGroup error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Group review queue ────────────────────────────────────────────────────

    async listPendingGroups(
        q: AdminListGroupsQuery,
    ): Promise<{ data: PendingGroupItem[]; pagination: PaginationMeta }> {
        try {
            const page = Math.max(q.page ?? 1, 1);
            const limit = Math.min(q.limit ?? 20, 100);
            const skip = (page - 1) * limit;

            const where: Prisma.GroupWhereInput = {
                reviewStatus: q.review_status ?? 'pending',
                deletedAt: null,
            };

            if (q.search) {
                where.OR = [
                    { name: { contains: q.search, mode: 'insensitive' } },
                    { slug: { contains: q.search, mode: 'insensitive' } },
                ];
            }

            const [rows, total] = await Promise.all([
                prisma.group.findMany({
                    where,
                    select: adminPendingGroupSelect,
                    skip,
                    take: limit,
                    // Oldest first — the queue is a FIFO, and the "usually within 24 hours"
                    // promise is only keepable if the longest-waiting group is reviewed first.
                    orderBy: { createdAt: 'asc' },
                }),
                prisma.group.count({ where }),
            ]);

            const data: PendingGroupItem[] = rows.map((group) => ({
                id: group.id,
                name: group.name,
                slug: group.slug,
                category: group.category,
                description: group.description,
                coverImageUrl: group.coverImageUrl,
                city: group.city,
                state: group.state,
                memberCount: group.memberCount,
                createdAt: group.createdAt,
                creator: group.creator
                    ? {
                        id: group.creator.id,
                        displayName: group.creator.displayName,
                        email: group.creator.email,
                        bio: group.creator.bio,
                        // Booleans rather than timestamps: the reviewer needs a yes/no, and
                        // the timestamp is a verification detail they have no use for.
                        phoneVerified: Boolean(group.creator.phoneVerifiedAt),
                        emailVerified: Boolean(group.creator.emailVerifiedAt),
                        idVerificationStatus: group.creator.idVerificationStatus,
                        groupsCreated: group.creator._count.groupsCreated,
                    }
                    : null,
            }));

            return { data, pagination: { page, limit, total } };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.listPendingGroups error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    /**
     * Approves or rejects a group for Explore.
     *
     * Rejection does not delete or suspend anything: the group keeps working for the
     * people already in it, it simply stays unlisted. That is the whole point of letting
     * groups go live immediately — the review gates discovery, not existence.
     */
    async reviewGroup(
        groupId: string,
        dto: AdminReviewGroupDTO,
        actor: TokenPayload,
    ): Promise<unknown> {
        try {
            const group = await prisma.group.findUnique({
                where: { id: groupId },
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    reviewStatus: true,
                    coverImageUrl: true,
                    createdBy: true,
                    deletedAt: true,
                },
            });

            if (!group || group.deletedAt) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }

            // Approving a group with no cover would leave it approved but still unlisted,
            // and the organiser would have no idea why. Fail loudly instead.
            if (dto.decision === 'approve' && !group.coverImageUrl) {
                throw new ApiError(
                    'This group has no cover image and cannot be published yet.',
                    StatusCodes.UNPROCESSABLE_ENTITY,
                );
            }

            if (dto.decision === 'reject' && !dto.notes?.trim()) {
                throw new ApiError(
                    'A rejection must include notes — the organiser is shown them verbatim.',
                    StatusCodes.BAD_REQUEST,
                );
            }

            const reviewStatus = dto.decision === 'approve' ? 'approved' : 'rejected';

            const updated = await prisma.group.update({
                where: { id: groupId },
                data: {
                    reviewStatus,
                    reviewedBy: actor.userId,
                    reviewedAt: new Date(),
                    reviewNotes: dto.notes?.trim() ?? null,
                },
                select: adminGroupSelect,
            });

            if (group.createdBy) {
                const groupUrl = `${config.server.clientUrl}/groups/${group.slug}`;

                await NotificationDispatcher.dispatch({
                    userIds: [group.createdBy],
                    groupId,
                    type: reviewStatus === 'approved' ? 'group_approved' : 'group_rejected',
                    title:
                        reviewStatus === 'approved'
                            ? `${group.name} is now live in Explore`
                            : `${group.name} was not approved for Explore`,
                    body: dto.notes?.trim() ?? undefined,
                    referenceType: 'group',
                    referenceId: groupId,
                    email: {
                        subject:
                            reviewStatus === 'approved'
                                ? `${group.name} is live on GroupSync`
                                : `Update on ${group.name}`,
                        template: reviewStatus === 'approved' ? 'group_approved' : 'group_rejected',
                        data: {
                            groupName: group.name,
                            groupUrl,
                            reviewNotes: dto.notes?.trim() ?? 'No additional notes were provided.',
                        },
                    },
                });
            }

            AuditLogger.log(actor, LogActions.ADMIN_GROUP_REVIEW, ResourceTypes.GROUP, groupId, 1, {
                decision: dto.decision,
            });

            return updated;
        } catch (error) {
            AuditLogger.log(actor, LogActions.ADMIN_GROUP_REVIEW, ResourceTypes.GROUP, groupId, 0, { error });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.reviewGroup error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Reports ───────────────────────────────────────────────────────────────

    async listReports(q: AdminListReportsQuery): Promise<{ data: unknown[]; pagination: PaginationMeta }> {
        try {
            const page = Math.max(q.page ?? 1, 1);
            const limit = Math.min(q.limit ?? 20, 100);
            const skip = (page - 1) * limit;

            const where: Prisma.ReportWhereInput = {};
            if (q.status) where.status = q.status;

            const [data, total] = await Promise.all([
                prisma.report.findMany({ where, select: adminReportSelect, skip, take: limit, orderBy: { createdAt: 'desc' } }),
                prisma.report.count({ where }),
            ]);

            return { data, pagination: { page, limit, total } };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.listReports error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async resolveReport(reportId: string, dto: AdminResolveReportDTO, actor: TokenPayload): Promise<unknown> {
        try {
            const report = await prisma.report.findUnique({ where: { id: reportId }, select: { id: true } });
            if (!report) throw new ApiError(Messages.RESOURCE_NOT_FOUND('Report'), StatusCodes.NOT_FOUND);

            const updated = await prisma.report.update({
                where: { id: reportId },
                data: {
                    status: dto.action,
                    reviewedBy: actor.userId,
                    reviewedAt: new Date(),
                },
                select: adminReportSelect,
            });

            AuditLogger.log(actor, LogActions.ADMIN_REPORT_RESOLVE, ResourceTypes.REPORT, reportId, 1, { action: dto.action });

            return updated;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.resolveReport error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Audit logs ────────────────────────────────────────────────────────────

    async listAuditLogs(q: AdminListAuditLogsQuery): Promise<{ data: unknown[]; pagination: PaginationMeta }> {
        try {
            const page = Math.max(q.page ?? 1, 1);
            const limit = Math.min(q.limit ?? 20, 100);
            const skip = (page - 1) * limit;

            const where: Prisma.AuditLogWhereInput = {};
            if (q.user_id) where.userId = q.user_id;
            if (q.action) where.action = { contains: q.action, mode: 'insensitive' };
            if (q.entity_type) where.entityType = q.entity_type;
            if (q.date_from || q.date_to) {
                where.createdAt = {};
                if (q.date_from) {
                    const from = new Date(q.date_from);
                    from.setUTCHours(0, 0, 0, 0);
                    (where.createdAt as Prisma.DateTimeFilter).gte = from;
                }
                if (q.date_to) {
                    const to = new Date(q.date_to);
                    to.setUTCHours(23, 59, 59, 999);
                    (where.createdAt as Prisma.DateTimeFilter).lte = to;
                }
            }

            const [data, total] = await Promise.all([
                prisma.auditLog.findMany({ where, select: adminAuditSelect, skip, take: limit, orderBy: { createdAt: 'desc' } }),
                prisma.auditLog.count({ where }),
            ]);

            return { data, pagination: { page, limit, total } };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.listAuditLogs error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Platform stats ────────────────────────────────────────────────────────
    // Uses one raw SQL query per table with FILTER clauses — single round-trip per table.

    async getStats(): Promise<PlatformStats> {
        try {
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekStart  = new Date(todayStart); weekStart.setDate(todayStart.getDate() - 7);

            const [userRow, groupRow, contentRow, modRow] = await Promise.all([
                prisma.$queryRaw<[{
                    total: bigint; active: bigint; suspended: bigint; banned: bigint;
                    new_today: bigint; new_week: bigint; pending_verification: bigint; platform_admins: bigint;
                }]>`
                    SELECT
                        COUNT(*) FILTER (WHERE deleted_at IS NULL)                                     AS total,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active')               AS active,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'suspended')            AS suspended,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'banned')               AS banned,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= ${todayStart})     AS new_today,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= ${weekStart})      AS new_week,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND id_verification_status = 'submitted') AS pending_verification,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND role IN ('admin','super_admin')) AS platform_admins
                    FROM users
                `,

                prisma.$queryRaw<[{
                    total: bigint; active: bigint; suspended: bigint; verified: bigint; new_week: bigint;
                }]>`
                    SELECT
                        COUNT(*) FILTER (WHERE deleted_at IS NULL)                                AS total,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active')          AS active,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'suspended')       AS suspended,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_verified = TRUE)         AS verified,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= ${weekStart}) AS new_week
                    FROM groups
                `,

                prisma.$queryRaw<[{
                    msg_total: bigint; msg_today: bigint; dm_total: bigint; dm_today: bigint;
                }]>`
                    SELECT
                        (SELECT COUNT(*) FROM messages)                                              AS msg_total,
                        (SELECT COUNT(*) FROM messages  WHERE created_at >= ${todayStart})           AS msg_today,
                        (SELECT COUNT(*) FROM direct_messages)                                       AS dm_total,
                        (SELECT COUNT(*) FROM direct_messages WHERE created_at >= ${todayStart})     AS dm_today
                `,

                prisma.$queryRaw<[{
                    reports_open: bigint; resolved_today: bigint;
                }]>`
                    SELECT
                        COUNT(*) FILTER (WHERE status = 'open')                                           AS reports_open,
                        COUNT(*) FILTER (WHERE status = 'resolved' AND reviewed_at >= ${todayStart})      AS resolved_today
                    FROM reports
                `,
            ]);

            const u = userRow[0];
            const g = groupRow[0];
            const c = contentRow[0];
            const m = modRow[0];

            return {
                users: {
                    total:                Number(u.total),
                    active:               Number(u.active),
                    suspended:            Number(u.suspended),
                    banned:               Number(u.banned),
                    new_today:            Number(u.new_today),
                    new_this_week:        Number(u.new_week),
                    pending_verification: Number(u.pending_verification),
                    platform_admins:      Number(u.platform_admins),
                },
                groups: {
                    total:        Number(g.total),
                    active:       Number(g.active),
                    suspended:    Number(g.suspended),
                    verified:     Number(g.verified),
                    new_this_week:Number(g.new_week),
                },
                content: {
                    messages_total: Number(c.msg_total),
                    messages_today: Number(c.msg_today),
                    dms_total:      Number(c.dm_total),
                    dms_today:      Number(c.dm_today),
                },
                moderation: {
                    reports_open:           Number(m.reports_open),
                    reports_resolved_today: Number(m.resolved_today),
                    pending_id_verifications: Number(u.pending_verification),
                },
            };
        } catch (error) {
            asLogger.error('AdminService.getStats error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Change user platform role ─────────────────────────────────────────────

    async changeUserRole(userId: string, dto: AdminChangeRoleDTO, actor: TokenPayload): Promise<unknown> {
        try {
            // Cannot demote yourself — prevents accidental lockout
            if (userId === actor.userId) {
                throw new ApiError('You cannot change your own platform role.', StatusCodes.FORBIDDEN);
            }

            const user = await prisma.user.findUnique({
                where: { id: userId, deletedAt: null },
                select: { id: true, displayName: true },
            });
            if (!user) throw new ApiError(Messages.RESOURCE_NOT_FOUND('User'), StatusCodes.NOT_FOUND);

            const updated = await prisma.user.update({
                where: { id: userId },
                data: { role: dto.role },
                select: adminUserSelect,
            });

            AuditLogger.log(actor, LogActions.ADMIN_USER_UPDATE, ResourceTypes.USER, userId, 1, {
                action: 'role_change',
                new_role: dto.role,
            });

            return updated;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.changeUserRole error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ─── Taxonomy: categories ─────────────────────────────────────────────────

    async listCategories(query: AdminListTaxonomyQuery): Promise<unknown> {
        try {
            return await prisma.category.findMany({
                where: query.include_inactive ? {} : { isActive: true },
                orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
                select: adminCategorySelect,
            });
        } catch (error) {
            asLogger.error('AdminService.listCategories error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async createCategory(dto: AdminCreateCategoryDTO, actor: TokenPayload): Promise<unknown> {
        const value = dto.value.trim();
        try {
            const existing = await prisma.category.findUnique({ where: { value }, select: { id: true } });
            if (existing) {
                throw new ApiError('A category with this value already exists.', StatusCodes.CONFLICT);
            }

            const created = await prisma.category.create({
                data: {
                    value,
                    label: dto.label?.trim() || value,
                    sortOrder: dto.sort_order ?? 0,
                    isActive: dto.is_active ?? true,
                },
                select: adminCategorySelect,
            });

            AuditLogger.log(actor, LogActions.ADMIN_CATEGORY_CREATE, ResourceTypes.CATEGORY, created.id, 1, { value });
            return created;
        } catch (error: any) {
            AuditLogger.log(actor, LogActions.ADMIN_CATEGORY_CREATE, ResourceTypes.CATEGORY, null, 0, { value, error: error.message });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.createCategory error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async updateCategory(id: string, dto: AdminUpdateCategoryDTO, actor: TokenPayload): Promise<unknown> {
        try {
            const existing = await prisma.category.findUnique({ where: { id }, select: { id: true } });
            if (!existing) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Category'), StatusCodes.NOT_FOUND);
            }

            // `value` is deliberately not updatable: it is the string already written to
            // groups.category, and renaming it would orphan every group filed under it.
            const updated = await prisma.category.update({
                where: { id },
                data: {
                    ...(dto.label !== undefined     ? { label: dto.label.trim() } : {}),
                    ...(dto.sort_order !== undefined ? { sortOrder: dto.sort_order } : {}),
                    ...(dto.is_active !== undefined  ? { isActive: dto.is_active } : {}),
                },
                select: adminCategorySelect,
            });

            AuditLogger.log(actor, LogActions.ADMIN_CATEGORY_UPDATE, ResourceTypes.CATEGORY, id, 1, { ...dto });
            return updated;
        } catch (error: any) {
            AuditLogger.log(actor, LogActions.ADMIN_CATEGORY_UPDATE, ResourceTypes.CATEGORY, id, 0, { error: error.message });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.updateCategory error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async deleteCategory(id: string, actor: TokenPayload): Promise<unknown> {
        try {
            const category = await prisma.category.findUnique({ where: { id }, select: { id: true, value: true } });
            if (!category) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Category'), StatusCodes.NOT_FOUND);
            }

            // Groups store the category as a string with no foreign key, so deleting a
            // category in use would leave those groups pointing at a label that no longer
            // resolves. Deactivating hides it from the pickers and keeps them readable.
            const inUse = await prisma.group.count({ where: { category: category.value, deletedAt: null } });
            if (inUse > 0) {
                const deactivated = await prisma.category.update({
                    where: { id },
                    data: { isActive: false },
                    select: adminCategorySelect,
                });
                AuditLogger.log(actor, LogActions.ADMIN_CATEGORY_DELETE, ResourceTypes.CATEGORY, id, 1, { deactivatedInstead: true, inUse });
                return { ...deactivated, deactivatedInsteadOfDeleted: true, groupsUsingIt: inUse };
            }

            await prisma.category.delete({ where: { id } });
            AuditLogger.log(actor, LogActions.ADMIN_CATEGORY_DELETE, ResourceTypes.CATEGORY, id, 1, { value: category.value });
            return { id, deleted: true };
        } catch (error: any) {
            AuditLogger.log(actor, LogActions.ADMIN_CATEGORY_DELETE, ResourceTypes.CATEGORY, id, 0, { error: error.message });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.deleteCategory error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ─── Taxonomy: interests ──────────────────────────────────────────────────

    async listInterests(query: AdminListTaxonomyQuery): Promise<unknown> {
        try {
            return await prisma.interest.findMany({
                where: query.include_inactive ? {} : { isActive: true },
                orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
                select: adminInterestSelect,
            });
        } catch (error) {
            asLogger.error('AdminService.listInterests error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async createInterest(dto: AdminCreateInterestDTO, actor: TokenPayload): Promise<unknown> {
        // Interests are matched against users.interests, which UserService lowercases on
        // write — a capitalised value here would simply never match anyone.
        const value = dto.value.trim().toLowerCase();
        try {
            const existing = await prisma.interest.findUnique({ where: { value }, select: { id: true } });
            if (existing) {
                throw new ApiError('An interest with this value already exists.', StatusCodes.CONFLICT);
            }

            const created = await prisma.interest.create({
                data: {
                    value,
                    label: dto.label?.trim() || value,
                    group: dto.group.trim(),
                    sortOrder: dto.sort_order ?? 0,
                    isActive: dto.is_active ?? true,
                },
                select: adminInterestSelect,
            });

            AuditLogger.log(actor, LogActions.ADMIN_INTEREST_CREATE, ResourceTypes.INTEREST, created.id, 1, { value });
            return created;
        } catch (error: any) {
            AuditLogger.log(actor, LogActions.ADMIN_INTEREST_CREATE, ResourceTypes.INTEREST, null, 0, { value, error: error.message });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.createInterest error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async updateInterest(id: string, dto: AdminUpdateInterestDTO, actor: TokenPayload): Promise<unknown> {
        try {
            const existing = await prisma.interest.findUnique({ where: { id }, select: { id: true } });
            if (!existing) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Interest'), StatusCodes.NOT_FOUND);
            }

            const updated = await prisma.interest.update({
                where: { id },
                data: {
                    ...(dto.label !== undefined      ? { label: dto.label.trim() } : {}),
                    ...(dto.group !== undefined      ? { group: dto.group.trim() } : {}),
                    ...(dto.sort_order !== undefined ? { sortOrder: dto.sort_order } : {}),
                    ...(dto.is_active !== undefined  ? { isActive: dto.is_active } : {}),
                },
                select: adminInterestSelect,
            });

            AuditLogger.log(actor, LogActions.ADMIN_INTEREST_UPDATE, ResourceTypes.INTEREST, id, 1, { ...dto });
            return updated;
        } catch (error: any) {
            AuditLogger.log(actor, LogActions.ADMIN_INTEREST_UPDATE, ResourceTypes.INTEREST, id, 0, { error: error.message });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.updateInterest error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async deleteInterest(id: string, actor: TokenPayload): Promise<unknown> {
        try {
            const interest = await prisma.interest.findUnique({ where: { id }, select: { id: true, value: true } });
            if (!interest) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Interest'), StatusCodes.NOT_FOUND);
            }

            const inUse = await prisma.user.count({ where: { interests: { has: interest.value }, deletedAt: null } });
            if (inUse > 0) {
                const deactivated = await prisma.interest.update({
                    where: { id },
                    data: { isActive: false },
                    select: adminInterestSelect,
                });
                AuditLogger.log(actor, LogActions.ADMIN_INTEREST_DELETE, ResourceTypes.INTEREST, id, 1, { deactivatedInstead: true, inUse });
                return { ...deactivated, deactivatedInsteadOfDeleted: true, usersUsingIt: inUse };
            }

            await prisma.interest.delete({ where: { id } });
            AuditLogger.log(actor, LogActions.ADMIN_INTEREST_DELETE, ResourceTypes.INTEREST, id, 1, { value: interest.value });
            return { id, deleted: true };
        } catch (error: any) {
            AuditLogger.log(actor, LogActions.ADMIN_INTEREST_DELETE, ResourceTypes.INTEREST, id, 0, { error: error.message });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.deleteInterest error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ─── Event moderation ─────────────────────────────────────────────────────

    async listEvents(query: AdminListEventsQuery): Promise<{ data: unknown[]; pagination: PaginationMeta }> {
        try {
            const page  = query.page  && query.page  > 0 ? query.page  : 1;
            const limit = Math.min(query.limit && query.limit > 0 ? query.limit : 20, 50);
            const skip  = (page - 1) * limit;

            const where: Prisma.EventWhereInput = {
                ...(query.status ? { status: query.status } : {}),
                ...(query.when === 'upcoming' ? { startsAt: { gte: new Date() } } : {}),
                ...(query.when === 'past'     ? { startsAt: { lt: new Date() } }  : {}),
                ...(query.search
                    ? {
                        OR: [
                            { title: { contains: query.search, mode: 'insensitive' } },
                            { group: { name: { contains: query.search, mode: 'insensitive' } } },
                        ],
                    }
                    : {}),
            };

            const [data, total] = await Promise.all([
                prisma.event.findMany({ where, skip, take: limit, orderBy: { startsAt: 'desc' }, select: adminEventSelect }),
                prisma.event.count({ where }),
            ]);

            return { data, pagination: { page, limit, total } };
        } catch (error) {
            asLogger.error('AdminService.listEvents error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async cancelEvent(eventId: string, dto: AdminCancelEventDTO, actor: TokenPayload): Promise<unknown> {
        try {
            const event = await prisma.event.findUnique({
                where: { id: eventId },
                select: { id: true, title: true, status: true, groupId: true },
            });

            if (!event) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Event'), StatusCodes.NOT_FOUND);
            }
            if (event.status === 'cancelled') {
                throw new ApiError('This event is already cancelled.', StatusCodes.CONFLICT);
            }

            const updated = await prisma.event.update({
                where: { id: eventId },
                data: { status: 'cancelled' },
                select: adminEventSelect,
            });

            // Everyone who said they were going planned around this. Tell them, and say
            // why — a silently vanishing event is worse than a cancelled one.
            const rsvps = await prisma.eventRsvp.findMany({
                where: { eventId, status: { in: ['going', 'maybe'] } },
                select: { userId: true },
            });

            if (rsvps.length) {
                await NotificationDispatcher.dispatch({
                    userIds: rsvps.map((r) => r.userId),
                    groupId: event.groupId,
                    type: 'system',
                    title: `Cancelled: ${event.title}`,
                    body: dto.reason.trim(),
                    referenceType: 'event',
                    referenceId: eventId,
                });
            }

            AuditLogger.log(actor, LogActions.ADMIN_EVENT_CANCEL, ResourceTypes.EVENT, eventId, 1, { reason: dto.reason, notified: rsvps.length });
            return updated;
        } catch (error: any) {
            AuditLogger.log(actor, LogActions.ADMIN_EVENT_CANCEL, ResourceTypes.EVENT, eventId, 0, { error: error.message });
            if (error instanceof ApiError) throw error;
            asLogger.error('AdminService.cancelEvent error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}

export const adminService = new AdminService();
