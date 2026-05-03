import { Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { GroupService } from './group.service';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { AuthenticatedRequest } from './group.types';

const groupService = new GroupService();

function parsePagination(req: AuthenticatedRequest) {
    const page  = Math.max(1, parseInt(req.query.page  as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    return { page, limit };
}

export class GroupController {
    // ─── POST /groups ──────────────────────────────────────────────────────────

    createGroup = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const group = await groupService.createGroup(req.body, req.user!);
            ResponseHelper.success(res, group, 'Group created successfully.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /groups ───────────────────────────────────────────────────────────

    listGroups = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const query = {
                q:               req.query.q              as string | undefined,
                category:        req.query.category       as string | undefined,
                subcategory:     req.query.subcategory     as string | undefined,
                city:            req.query.city            as string | undefined,
                state:           req.query.state           as string | undefined,
                country:         req.query.country         as string | undefined,
                lat:             req.query.lat             ? parseFloat(req.query.lat as string)    : undefined,
                lng:             req.query.lng             ? parseFloat(req.query.lng as string)    : undefined,
                radius_km:       req.query.radius_km       ? parseFloat(req.query.radius_km as string) : undefined,
                membership_type: req.query.membership_type as string | undefined,
                min_members:     req.query.min_members     ? parseInt(req.query.min_members as string, 10) : undefined,
                max_members:     req.query.max_members     ? parseInt(req.query.max_members as string, 10) : undefined,
                is_verified:     req.query.is_verified     !== undefined ? req.query.is_verified === 'true' : undefined,
                sort:            req.query.sort            as any,
                page:            parseInt(req.query.page  as string, 10) || 1,
                limit:           parseInt(req.query.limit as string, 10) || 20,
            };

            const result = await groupService.listGroups(query, req.user?.userId);
            ResponseHelper.success(res, result.data, 'Success', StatusCodes.OK, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /groups/:slug ─────────────────────────────────────────────────────

    getGroupBySlug = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await groupService.getGroupBySlug(req.params.slug, req.user?.userId);
            ResponseHelper.success(res, result);
        } catch (error) {
            next(error);
        }
    };

    // ─── PATCH /groups/:id ─────────────────────────────────────────────────────

    updateGroup = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const group = await groupService.updateGroup(req.params.id, req.body, req.user!);
            ResponseHelper.success(res, group, 'Group updated successfully.');
        } catch (error) {
            next(error);
        }
    };

    // ─── DELETE /groups/:id ────────────────────────────────────────────────────

    deleteGroup = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await groupService.deleteGroup(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'Group deleted successfully.');
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /groups/:id/members ───────────────────────────────────────────────

    getGroupMembers = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { page, limit } = parsePagination(req);
            const role   = req.query.role   as string | undefined;
            const search = req.query.search as string | undefined;
            const result = await groupService.getGroupMembers(req.params.id, page, limit, role, search);
            ResponseHelper.success(res, result.data, 'Success', StatusCodes.OK, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /groups/:id/stats ─────────────────────────────────────────────────

    getGroupStats = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const stats = await groupService.getGroupStats(req.params.id, req.user!);
            ResponseHelper.success(res, stats);
        } catch (error) {
            next(error);
        }
    };
}
