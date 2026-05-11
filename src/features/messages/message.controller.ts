import { Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AuthenticatedRequest } from '../../shared/middleware/auth.middleware';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { messageService } from './message.service';
import { SendMessageDTO, ListMessagesQuery, ToggleChatLockDTO } from './message.types';

export class MessageController {
    listMessages = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query: ListMessagesQuery = {
                cursor: req.query.cursor as string | undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
                direction: req.query.direction as 'before' | 'after' | undefined,
            };
            const result = await messageService.listMessages(req.params.id, query, req.user!);
            ResponseHelper.success(res, result.data, 'Messages retrieved.', StatusCodes.OK, {
                next_cursor: result.next_cursor,
                has_more: result.has_more,
            } as any);
        } catch (error) {
            next(error);
        }
    };

    sendMessage = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const message = await messageService.sendMessage(req.params.id, req.body as SendMessageDTO, req.user!);
            ResponseHelper.success(res, message, 'Message sent.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    deleteMessage = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await messageService.deleteMessage(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'Message deleted.');
        } catch (error) {
            next(error);
        }
    };

    togglePin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const message = await messageService.togglePin(req.params.id, req.user!);
            ResponseHelper.success(res, message, 'Message pin updated.');
        } catch (error) {
            next(error);
        }
    };

    addReaction = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await messageService.addReaction(req.params.id, req.body.emoji, req.user!);
            ResponseHelper.success(res, null, 'Reaction added.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    removeReaction = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await messageService.removeReaction(req.params.id, req.body.emoji, req.user!);
            ResponseHelper.success(res, null, 'Reaction removed.');
        } catch (error) {
            next(error);
        }
    };

    listPinned = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const messages = await messageService.listPinned(req.params.id, req.user!);
            ResponseHelper.success(res, messages, 'Pinned messages retrieved.');
        } catch (error) {
            next(error);
        }
    };

    toggleChatLock = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await messageService.toggleChatLock(req.params.id, (req.body as ToggleChatLockDTO).locked, req.user!);
            ResponseHelper.success(res, result, `Chat ${result.is_chat_locked ? 'locked' : 'unlocked'}.`);
        } catch (error) {
            next(error);
        }
    };
}

export const messageController = new MessageController();
