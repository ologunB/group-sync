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
}
exports.AdminService = AdminService;
exports.adminService = new AdminService();
//# sourceMappingURL=admin.service.js.map