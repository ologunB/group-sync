"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminService = exports.AdminService = void 0;
const http_status_codes_1 = require("http-status-codes");
const connection_1 = require("../../database/connection");
const error_middleware_1 = require("../../shared/middleware/error.middleware");
const response_constants_1 = require("../../shared/utils/response.constants");
const asLogger_1 = require("../../shared/utils/asLogger");
const audit_logger_1 = require("../../shared/utils/audit.logger");
const admin_types_1 = require("./admin.types");
class AdminService {
    // ── Users ─────────────────────────────────────────────────────────────────
    async listUsers(q) {
        try {
            const page = Math.max(q.page ?? 1, 1);
            const limit = Math.min(q.limit ?? 20, 100);
            const skip = (page - 1) * limit;
            const where = { deletedAt: null };
            if (q.status)
                where.status = q.status;
            if (q.search) {
                where.OR = [
                    { displayName: { contains: q.search, mode: 'insensitive' } },
                    { email: { contains: q.search, mode: 'insensitive' } },
                    { username: { contains: q.search, mode: 'insensitive' } },
                ];
            }
            const [data, total] = await Promise.all([
                connection_1.prisma.user.findMany({ where, select: admin_types_1.adminUserSelect, skip, take: limit, orderBy: { createdAt: 'desc' } }),
                connection_1.prisma.user.count({ where }),
            ]);
            return { data, pagination: { page, limit, total } };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AdminService.listUsers error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    async updateUserStatus(userId, dto, actor) {
        try {
            const user = await connection_1.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
            if (!user)
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            const updated = await connection_1.prisma.user.update({
                where: { id: userId },
                data: { status: dto.status },
                select: admin_types_1.adminUserSelect,
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.ADMIN_USER_UPDATE, audit_logger_1.ResourceTypes.USER, userId, 1, { status: dto.status });
            return updated;
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.ADMIN_USER_UPDATE, audit_logger_1.ResourceTypes.USER, userId, 0, { error });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AdminService.updateUserStatus error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    async getUserVerification(userId) {
        try {
            const user = await connection_1.prisma.user.findUnique({
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
            if (!user)
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            return user;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AdminService.getUserVerification error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    async reviewIdVerification(userId, dto, actor) {
        try {
            const user = await connection_1.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
            if (!user)
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            const newStatus = dto.decision === 'approved' ? 'verified' : 'rejected';
            const updated = await connection_1.prisma.user.update({
                where: { id: userId },
                data: {
                    idVerificationStatus: newStatus,
                    idVerifiedAt: dto.decision === 'approved' ? new Date() : null,
                    // Clear document after decision
                    idDocumentUrl: null,
                    idDocumentIv: null,
                },
                select: admin_types_1.adminUserSelect,
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.ADMIN_USER_VERIFY_ID, audit_logger_1.ResourceTypes.USER, userId, 1, {
                decision: dto.decision,
                rejection_reason: dto.rejection_reason,
            });
            return updated;
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.ADMIN_USER_VERIFY_ID, audit_logger_1.ResourceTypes.USER, userId, 0, { error });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AdminService.reviewIdVerification error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Groups ────────────────────────────────────────────────────────────────
    async listGroups(q) {
        try {
            const page = Math.max(q.page ?? 1, 1);
            const limit = Math.min(q.limit ?? 20, 100);
            const skip = (page - 1) * limit;
            const where = {};
            if (q.status)
                where.status = q.status;
            if (q.search) {
                where.OR = [
                    { name: { contains: q.search, mode: 'insensitive' } },
                    { slug: { contains: q.search, mode: 'insensitive' } },
                ];
            }
            const [data, total] = await Promise.all([
                connection_1.prisma.group.findMany({ where, select: admin_types_1.adminGroupSelect, skip, take: limit, orderBy: { createdAt: 'desc' } }),
                connection_1.prisma.group.count({ where }),
            ]);
            return { data, pagination: { page, limit, total } };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AdminService.listGroups error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    async updateGroup(groupId, dto, actor) {
        try {
            const group = await connection_1.prisma.group.findUnique({ where: { id: groupId }, select: { id: true } });
            if (!group)
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            const updated = await connection_1.prisma.group.update({
                where: { id: groupId },
                data: {
                    ...(dto.status !== undefined && { status: dto.status }),
                    ...(dto.is_verified !== undefined && { isVerified: dto.is_verified }),
                },
                select: admin_types_1.adminGroupSelect,
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.ADMIN_GROUP_UPDATE, audit_logger_1.ResourceTypes.GROUP, groupId, 1, dto);
            return updated;
        }
        catch (error) {
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.ADMIN_GROUP_UPDATE, audit_logger_1.ResourceTypes.GROUP, groupId, 0, { error });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AdminService.updateGroup error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Reports ───────────────────────────────────────────────────────────────
    async listReports(q) {
        try {
            const page = Math.max(q.page ?? 1, 1);
            const limit = Math.min(q.limit ?? 20, 100);
            const skip = (page - 1) * limit;
            const where = {};
            if (q.status)
                where.status = q.status;
            const [data, total] = await Promise.all([
                connection_1.prisma.report.findMany({ where, select: admin_types_1.adminReportSelect, skip, take: limit, orderBy: { createdAt: 'desc' } }),
                connection_1.prisma.report.count({ where }),
            ]);
            return { data, pagination: { page, limit, total } };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AdminService.listReports error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    async resolveReport(reportId, dto, actor) {
        try {
            const report = await connection_1.prisma.report.findUnique({ where: { id: reportId }, select: { id: true } });
            if (!report)
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Report'), http_status_codes_1.StatusCodes.NOT_FOUND);
            const updated = await connection_1.prisma.report.update({
                where: { id: reportId },
                data: {
                    status: dto.action,
                    reviewedBy: actor.userId,
                    reviewedAt: new Date(),
                },
                select: admin_types_1.adminReportSelect,
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.ADMIN_REPORT_RESOLVE, audit_logger_1.ResourceTypes.REPORT, reportId, 1, { action: dto.action });
            return updated;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AdminService.resolveReport error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Audit logs ────────────────────────────────────────────────────────────
    async listAuditLogs(q) {
        try {
            const page = Math.max(q.page ?? 1, 1);
            const limit = Math.min(q.limit ?? 20, 100);
            const skip = (page - 1) * limit;
            const where = {};
            if (q.user_id)
                where.userId = q.user_id;
            if (q.action)
                where.action = { contains: q.action, mode: 'insensitive' };
            if (q.entity_type)
                where.entityType = q.entity_type;
            if (q.date_from || q.date_to) {
                where.createdAt = {};
                if (q.date_from) {
                    const from = new Date(q.date_from);
                    from.setUTCHours(0, 0, 0, 0);
                    where.createdAt.gte = from;
                }
                if (q.date_to) {
                    const to = new Date(q.date_to);
                    to.setUTCHours(23, 59, 59, 999);
                    where.createdAt.lte = to;
                }
            }
            const [data, total] = await Promise.all([
                connection_1.prisma.auditLog.findMany({ where, select: admin_types_1.adminAuditSelect, skip, take: limit, orderBy: { createdAt: 'desc' } }),
                connection_1.prisma.auditLog.count({ where }),
            ]);
            return { data, pagination: { page, limit, total } };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AdminService.listAuditLogs error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Platform stats ────────────────────────────────────────────────────────
    // Uses one raw SQL query per table with FILTER clauses — single round-trip per table.
    async getStats() {
        try {
            const now = new Date();
            const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekStart = new Date(todayStart);
            weekStart.setDate(todayStart.getDate() - 7);
            const [userRow, groupRow, contentRow, modRow] = await Promise.all([
                connection_1.prisma.$queryRaw `
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
                connection_1.prisma.$queryRaw `
                    SELECT
                        COUNT(*) FILTER (WHERE deleted_at IS NULL)                                AS total,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active')          AS active,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'suspended')       AS suspended,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND is_verified = TRUE)         AS verified,
                        COUNT(*) FILTER (WHERE deleted_at IS NULL AND created_at >= ${weekStart}) AS new_week
                    FROM groups
                `,
                connection_1.prisma.$queryRaw `
                    SELECT
                        (SELECT COUNT(*) FROM messages)                                              AS msg_total,
                        (SELECT COUNT(*) FROM messages  WHERE created_at >= ${todayStart})           AS msg_today,
                        (SELECT COUNT(*) FROM direct_messages)                                       AS dm_total,
                        (SELECT COUNT(*) FROM direct_messages WHERE created_at >= ${todayStart})     AS dm_today
                `,
                connection_1.prisma.$queryRaw `
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
                    total: Number(u.total),
                    active: Number(u.active),
                    suspended: Number(u.suspended),
                    banned: Number(u.banned),
                    new_today: Number(u.new_today),
                    new_this_week: Number(u.new_week),
                    pending_verification: Number(u.pending_verification),
                    platform_admins: Number(u.platform_admins),
                },
                groups: {
                    total: Number(g.total),
                    active: Number(g.active),
                    suspended: Number(g.suspended),
                    verified: Number(g.verified),
                    new_this_week: Number(g.new_week),
                },
                content: {
                    messages_total: Number(c.msg_total),
                    messages_today: Number(c.msg_today),
                    dms_total: Number(c.dm_total),
                    dms_today: Number(c.dm_today),
                },
                moderation: {
                    reports_open: Number(m.reports_open),
                    reports_resolved_today: Number(m.resolved_today),
                    pending_id_verifications: Number(u.pending_verification),
                },
            };
        }
        catch (error) {
            asLogger_1.asLogger.error('AdminService.getStats error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Change user platform role ─────────────────────────────────────────────
    async changeUserRole(userId, dto, actor) {
        try {
            // Cannot demote yourself — prevents accidental lockout
            if (userId === actor.userId) {
                throw new error_middleware_1.ApiError('You cannot change your own platform role.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            const user = await connection_1.prisma.user.findUnique({
                where: { id: userId, deletedAt: null },
                select: { id: true, displayName: true },
            });
            if (!user)
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            const updated = await connection_1.prisma.user.update({
                where: { id: userId },
                data: { role: dto.role },
                select: admin_types_1.adminUserSelect,
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.ADMIN_USER_UPDATE, audit_logger_1.ResourceTypes.USER, userId, 1, {
                action: 'role_change',
                new_role: dto.role,
            });
            return updated;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('AdminService.changeUserRole error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
exports.AdminService = AdminService;
exports.adminService = new AdminService();
//# sourceMappingURL=admin.service.js.map