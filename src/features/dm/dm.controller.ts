import { Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AuthenticatedRequest } from '../../shared/middleware/auth.middleware';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { dmService } from './dm.service';
import { SendDmDTO, ListThreadQuery, ListConversationsQuery } from './dm.types';


export class DmController {
    listConversations = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query: ListConversationsQuery = {
                type: req.query.type as ListConversationsQuery['type'] | undefined,
            };
            const data = await dmService.listConversations(req.user!, query);
            ResponseHelper.success(res, data, 'Conversations retrieved.');
        } catch (error) {
            next(error);
        }
    };

    getThread = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query: ListThreadQuery = {
                cursor: req.query.cursor as string | undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
            };
            const result = await dmService.getThread(req.params.userId, query, req.user!);
            ResponseHelper.success(res, result.data, 'Thread retrieved.', StatusCodes.OK, {
                next_cursor: result.next_cursor,
                has_more: result.has_more,
            } as any);
        } catch (error) {
            next(error);
        }
    };

    sendDm = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const media = req.file ? { buffer: req.file.buffer, mimeType: req.file.mimetype } : undefined;
            const dm = await dmService.sendDm(req.params.userId, req.body as SendDmDTO, req.user!, media);
            ResponseHelper.success(res, dm, 'DM sent.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    markRead = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await dmService.markRead(req.params.userId, req.user!);
            ResponseHelper.success(res, result, 'Thread marked as read.');
        } catch (error) {
            next(error);
        }
    };

    deleteDm = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await dmService.deleteDm(req.params.dmId, req.user!);
            ResponseHelper.success(res, null, 'Message deleted.');
        } catch (error) {
            next(error);
        }
    };

    addReaction = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await dmService.addReaction(req.params.dmId, req.body.emoji, req.user!);
            ResponseHelper.success(res, null, 'Reaction added.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    removeReaction = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await dmService.removeReaction(req.params.dmId, req.body.emoji, req.user!);
            ResponseHelper.success(res, null, 'Reaction removed.');
        } catch (error) {
            next(error);
        }
    };
}

export const dmController = new DmController();
