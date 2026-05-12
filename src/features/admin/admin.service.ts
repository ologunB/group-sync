import { Prisma } from '@prisma/client';
import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../database/connection';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import { asLogger } from '../../shared/utils/asLogger';
import { AuditLogger, LogActions, ResourceTypes } from '../../shared/utils/audit.logger';
import { TokenPayload, PaginationMeta } from '../../shared/types/common.types';
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
    PlatformStats,
    adminUserSelect,
    adminGroupSelect,
    adminReportSelect,
    adminAuditSelect,
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
}

export const adminService = new AdminService();
