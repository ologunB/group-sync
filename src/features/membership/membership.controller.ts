import { Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { MembershipService } from './membership.service';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { AuthenticatedRequest } from './membership.types';

const membershipService = new MembershipService();

function parsePagination(req: AuthenticatedRequest) {
    const page  = Math.max(1, parseInt(req.query.page  as string, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    return { page, limit };
}

export class MembershipController {
    // ─── POST /groups/:id/join ─────────────────────────────────────────────────

    joinGroup = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await membershipService.joinGroup(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'You have joined the group successfully.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /groups/:id/apply ────────────────────────────────────────────────

    applyToGroup = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await membershipService.applyToGroup(req.params.id, req.body, req.user!);
            ResponseHelper.success(res, result, 'Application submitted successfully.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    // ─── DELETE /groups/:id/leave ──────────────────────────────────────────────

    leaveGroup = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await membershipService.leaveGroup(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'You have left the group.');
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /groups/:id/applications ─────────────────────────────────────────

    getApplications = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const { page, limit } = parsePagination(req);
            const status = req.query.status as string | undefined;
            const result = await membershipService.getApplications(req.params.id, page, limit, status);
            ResponseHelper.success(res, result.data, 'Success', StatusCodes.OK, result.pagination);
        } catch (error) {
            next(error);
        }
    };

    // ─── PATCH /applications/:id ───────────────────────────────────────────────

    reviewApplication = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await membershipService.reviewApplication(req.params.id, req.body, req.user!);
            const msg = req.body.action === 'approve'
                ? 'Application approved. Member added to the group.'
                : 'Application rejected.';
            ResponseHelper.success(res, null, msg);
        } catch (error) {
            next(error);
        }
    };

    // ─── DELETE /applications/:id ──────────────────────────────────────────────

    withdrawApplication = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await membershipService.withdrawApplication(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'Application withdrawn successfully.');
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /groups/:id/form ──────────────────────────────────────────────────

    getGroupForm = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const form = await membershipService.getGroupForm(req.params.id);
            ResponseHelper.success(res, form);
        } catch (error) {
            next(error);
        }
    };

    // ─── PUT /groups/:id/form ──────────────────────────────────────────────────

    upsertGroupForm = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const form = await membershipService.upsertGroupForm(req.params.id, req.body, req.user!);
            ResponseHelper.success(res, form, 'Application form saved successfully.');
        } catch (error) {
            next(error);
        }
    };

    // ─── PATCH /groups/:id/members/:userId ────────────────────────────────────

    updateMember = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await membershipService.updateMember(
                req.params.id,
                req.params.userId,
                req.body,
                req.user!,
            );
            ResponseHelper.success(res, null, 'Member updated successfully.');
        } catch (error) {
            next(error);
        }
    };

    // ─── DELETE /groups/:id/members/:userId ───────────────────────────────────

    removeMember = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await membershipService.removeMember(req.params.id, req.params.userId, req.user!);
            ResponseHelper.success(res, null, 'Member removed from the group.');
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /groups/:id/invite ───────────────────────────────────────────────

    generateInviteLink = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const result = await membershipService.generateInviteLink(req.params.id, req.body, req.user!);
            ResponseHelper.success(res, result, 'Invite link generated.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /groups/:id/invites ───────────────────────────────────────────────

    getInviteLinks = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const links = await membershipService.getInviteLinks(req.params.id);
            ResponseHelper.success(res, links);
        } catch (error) {
            next(error);
        }
    };

    // ─── DELETE /invites/:id ───────────────────────────────────────────────────

    revokeInviteLink = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await membershipService.revokeInviteLink(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'Invite link revoked.');
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /invites/:token/accept ───────────────────────────────────────────

    acceptInvite = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            await membershipService.acceptInvite(req.params.token, req.user!);
            ResponseHelper.success(res, null, 'You have joined the group via invite link.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };
}
