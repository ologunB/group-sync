import { Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UserService } from './user.service';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { AuthenticatedRequest } from './user.types';

const userService = new UserService();

// ─── Pagination helper ────────────────────────────────────────────────────────

function parsePagination(req: AuthenticatedRequest): { page: number; limit: number } {
    const page  = Math.max(1, parseInt(req.query.page  as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    return { page, limit };
}

// ─── AuthController ───────────────────────────────────────────────────────────

export class UserController {
    // ─── GET /users/me ─────────────────────────────────────────────────────────

    getMe = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const user = await userService.getMe(req.user!);
            ResponseHelper.success(res, user);
        } catch (error) {
            next(error);
        }
    };

    // ─── PATCH /users/me ───────────────────────────────────────────────────────

    updateMe = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const user = await userService.updateMe(req.body, req.user!);
            ResponseHelper.success(res, user, 'Profile updated successfully.');
        } catch (error) {
            next(error);
        }
    };

    // ─── DELETE /users/me ──────────────────────────────────────────────────────

    deleteMe = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await userService.deleteMe(req.user!);
            ResponseHelper.success(res, null, 'Account deleted successfully.');
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /users/me/groups ──────────────────────────────────────────────────

    getMyGroups = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { page, limit } = parsePagination(req);
            const result = await userService.getMyGroups(req.user!, page, limit);
            ResponseHelper.success(res, result.data, 'Success', StatusCodes.OK, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /users/me/applications ────────────────────────────────────────────

    getMyApplications = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { page, limit } = parsePagination(req);
            const status = req.query.status as string | undefined;
            const result = await userService.getMyApplications(req.user!, page, limit, status);
            ResponseHelper.success(res, result.data, 'Success', StatusCodes.OK, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /users/me/interests ──────────────────────────────────────────────

    updateInterests = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await userService.updateInterests(req.body, req.user!);
            ResponseHelper.success(res, result, 'Interests updated successfully.');
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /users/:id ────────────────────────────────────────────────────────

    getUserById = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const user = await userService.getUserById(req.params.id, req.user!);
            ResponseHelper.success(res, user);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /users/:id/block ─────────────────────────────────────────────────

    blockUser = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await userService.blockUser(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'User blocked successfully.');
        } catch (error) {
            next(error);
        }
    };

    // ─── DELETE /users/:id/block ───────────────────────────────────────────────

    unblockUser = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await userService.unblockUser(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'User unblocked successfully.');
        } catch (error) {
            next(error);
        }
    };
}
