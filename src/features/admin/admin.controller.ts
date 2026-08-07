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
    AdminCreateCategoryDTO,
    AdminUpdateCategoryDTO,
    AdminCreateInterestDTO,
    AdminUpdateInterestDTO,
    AdminCancelEventDTO,
    AdminListAuditLogsQuery,
    AdminChangeRoleDTO,
    AdminReviewGroupDTO,
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
                review_status: req.query.review_status as AdminListGroupsQuery['review_status'],
            };
            const result = await adminService.listGroups(q);
            ResponseHelper.success(res, result.data, 'Groups retrieved.', 200, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    // GET /admin/groups/pending — the review queue.
    listPendingGroups = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const q: AdminListGroupsQuery = {
                page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
                search: req.query.search as string | undefined,
                review_status: req.query.review_status as AdminListGroupsQuery['review_status'],
            };
            const result = await adminService.listPendingGroups(q);
            ResponseHelper.success(res, result.data, 'Pending groups retrieved.', 200, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    // PATCH /admin/groups/:id/review
    reviewGroup = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const group = await adminService.reviewGroup(
                req.params.id,
                req.body as AdminReviewGroupDTO,
                req.user!,
            );
            ResponseHelper.success(res, group, 'Group review recorded.');
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

    // ── Stats ─────────────────────────────────────────────────────────────────

    getStats = async (_req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const stats = await adminService.getStats();
            ResponseHelper.success(res, stats, 'Platform stats retrieved.');
        } catch (error) {
            next(error);
        }
    };

    changeUserRole = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const user = await adminService.changeUserRole(req.params.id, req.body as AdminChangeRoleDTO, req.user!);
            ResponseHelper.success(res, user, 'User role updated.');
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

    // ─── Taxonomy: categories ─────────────────────────────────────────────────

    listCategories = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await adminService.listCategories({ include_inactive: req.query.include_inactive === 'true' });
            ResponseHelper.success(res, data);
        } catch (error) {
            next(error);
        }
    };

    createCategory = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await adminService.createCategory(req.body as AdminCreateCategoryDTO, req.user!);
            ResponseHelper.success(res, data, 'Category created.', 201);
        } catch (error) {
            next(error);
        }
    };

    updateCategory = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await adminService.updateCategory(req.params.id, req.body as AdminUpdateCategoryDTO, req.user!);
            ResponseHelper.success(res, data, 'Category updated.');
        } catch (error) {
            next(error);
        }
    };

    deleteCategory = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await adminService.deleteCategory(req.params.id, req.user!);
            ResponseHelper.success(res, data, 'Category removed.');
        } catch (error) {
            next(error);
        }
    };

    // ─── Taxonomy: interests ──────────────────────────────────────────────────

    listInterests = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await adminService.listInterests({ include_inactive: req.query.include_inactive === 'true' });
            ResponseHelper.success(res, data);
        } catch (error) {
            next(error);
        }
    };

    createInterest = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await adminService.createInterest(req.body as AdminCreateInterestDTO, req.user!);
            ResponseHelper.success(res, data, 'Interest created.', 201);
        } catch (error) {
            next(error);
        }
    };

    updateInterest = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await adminService.updateInterest(req.params.id, req.body as AdminUpdateInterestDTO, req.user!);
            ResponseHelper.success(res, data, 'Interest updated.');
        } catch (error) {
            next(error);
        }
    };

    deleteInterest = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await adminService.deleteInterest(req.params.id, req.user!);
            ResponseHelper.success(res, data, 'Interest removed.');
        } catch (error) {
            next(error);
        }
    };

    // ─── Event moderation ─────────────────────────────────────────────────────

    listEvents = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await adminService.listEvents({
                page:   req.query.page   ? parseInt(req.query.page as string, 10)   : undefined,
                limit:  req.query.limit  ? parseInt(req.query.limit as string, 10)  : undefined,
                status: req.query.status as 'scheduled' | 'cancelled' | 'completed' | undefined,
                search: req.query.search as string | undefined,
                when:   req.query.when   as 'upcoming' | 'past' | undefined,
            });
            ResponseHelper.success(res, result.data, 'Events retrieved.', 200, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    cancelEvent = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const data = await adminService.cancelEvent(req.params.id, req.body as AdminCancelEventDTO, req.user!);
            ResponseHelper.success(res, data, 'Event cancelled.');
        } catch (error) {
            next(error);
        }
    };
}

export const adminController = new AdminController();
