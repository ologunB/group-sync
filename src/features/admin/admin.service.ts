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

            await AuditLogger.log(actor, LogActions.ADMIN_USER_UPDATE, ResourceTypes.USER, userId, 1, { status: dto.status });

            return updated;
        } catch (error) {
            await AuditLogger.log(actor, LogActions.ADMIN_USER_UPDATE, ResourceTypes.USER, userId, 0, { error });
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

            await AuditLogger.log(actor, LogActions.ADMIN_USER_VERIFY_ID, ResourceTypes.USER, userId, 1, {
                decision: dto.decision,
                rejection_reason: dto.rejection_reason,
            });

            return updated;
        } catch (error) {
            await AuditLogger.log(actor, LogActions.ADMIN_USER_VERIFY_ID, ResourceTypes.USER, userId, 0, { error });
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

            await AuditLogger.log(actor, LogActions.ADMIN_GROUP_UPDATE, ResourceTypes.GROUP, groupId, 1, dto as Record<string, unknown>);

            return updated;
        } catch (error) {
            await AuditLogger.log(actor, LogActions.ADMIN_GROUP_UPDATE, ResourceTypes.GROUP, groupId, 0, { error });
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

            await AuditLogger.log(actor, LogActions.ADMIN_REPORT_RESOLVE, ResourceTypes.REPORT, reportId, 1, { action: dto.action });

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
}

export const adminService = new AdminService();
