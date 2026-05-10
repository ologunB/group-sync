import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../../shared/middleware/auth.middleware';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { adminService } from './admin.service';
import {
    AdminListUsersQuery,
    AdminUpdateUserDTO,
    AdminVerifyIdDTO,
    AdminListGroupsQuery,
    AdminUpdateGroupDTO,
    AdminListReportsQuery,
    AdminResolveReportDTO,
    AdminListAuditLogsQuery,
} from './admin.types';

export class AdminController {
    // ── Users ─────────────────────────────────────────────────────────────────

    listUsers = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const q: AdminListUsersQuery = {
                page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
                status: req.query.status as string | undefined,
                search: req.query.search as string | undefined,
            };
            const result = await adminService.listUsers(q);
            ResponseHelper.success(res, result.data, 'Users retrieved.', 200, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    updateUserStatus = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const user = await adminService.updateUserStatus(req.params.id, req.body as AdminUpdateUserDTO, req.user!);
            ResponseHelper.success(res, user, 'User status updated.');
        } catch (error) {
            next(error);
        }
    };

    getUserVerification = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await adminService.getUserVerification(req.params.id);
            ResponseHelper.success(res, data, 'User verification data retrieved.');
        } catch (error) {
            next(error);
        }
    };

    reviewIdVerification = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const user = await adminService.reviewIdVerification(req.params.id, req.body as AdminVerifyIdDTO, req.user!);
            ResponseHelper.success(res, user, 'ID verification decision recorded.');
        } catch (error) {
            next(error);
        }
    };

    // ── Groups ────────────────────────────────────────────────────────────────

    listGroups = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const q: AdminListGroupsQuery = {
                page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
                status: req.query.status as string | undefined,
                search: req.query.search as string | undefined,
            };
            const result = await adminService.listGroups(q);
            ResponseHelper.success(res, result.data, 'Groups retrieved.', 200, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    updateGroup = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const group = await adminService.updateGroup(req.params.id, req.body as AdminUpdateGroupDTO, req.user!);
            ResponseHelper.success(res, group, 'Group updated.');
        } catch (error) {
            next(error);
        }
    };

    // ── Reports ───────────────────────────────────────────────────────────────

    listReports = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const q: AdminListReportsQuery = {
                page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
                status: req.query.status as string | undefined,
            };
            const result = await adminService.listReports(q);
            ResponseHelper.success(res, result.data, 'Reports retrieved.', 200, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    resolveReport = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const report = await adminService.resolveReport(req.params.id, req.body as AdminResolveReportDTO, req.user!);
            ResponseHelper.success(res, report, 'Report resolved.');
        } catch (error) {
            next(error);
        }
    };

    // ── Audit logs ────────────────────────────────────────────────────────────

    listAuditLogs = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const q: AdminListAuditLogsQuery = {
                page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
                user_id: req.query.user_id as string | undefined,
                action: req.query.action as string | undefined,
                entity_type: req.query.entity_type as string | undefined,
                date_from: req.query.date_from as string | undefined,
                date_to: req.query.date_to as string | undefined,
            };
            const result = await adminService.listAuditLogs(q);
            ResponseHelper.success(res, result.data, 'Audit logs retrieved.', 200, result.pagination);
        } catch (error) {
            next(error);
        }
    };
}

export const adminController = new AdminController();
