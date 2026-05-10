import { Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AuthenticatedRequest } from '../../shared/middleware/auth.middleware';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { notificationService } from './notification.service';
import { ListNotificationsQuery, UpdatePreferencesDTO } from './notification.types';

export class NotificationController {
    list = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const query: ListNotificationsQuery = {
                cursor: req.query.cursor as string | undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
                unread_only: req.query.unread_only === 'true',
            };
            const result = await notificationService.listNotifications(query, req.user!);
            ResponseHelper.success(res, result, 'Notifications retrieved successfully.');
        } catch (error) {
            next(error);
        }
    };

    markRead = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const notification = await notificationService.markRead(req.params.id, req.user!);
            ResponseHelper.success(res, notification, 'Notification marked as read.');
        } catch (error) {
            next(error);
        }
    };

    markAllRead = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const result = await notificationService.markAllRead(req.user!);
            ResponseHelper.success(res, result, 'All notifications marked as read.');
        } catch (error) {
            next(error);
        }
    };

    deleteNotification = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await notificationService.deleteNotification(req.params.id, req.user!);
            ResponseHelper.success(res, null, 'Notification deleted.');
        } catch (error) {
            next(error);
        }
    };

    getPreferences = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const prefs = await notificationService.getPreferences(req.user!);
            ResponseHelper.success(res, prefs, 'Notification preferences retrieved.');
        } catch (error) {
            next(error);
        }
    };

    updatePreferences = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto = req.body as UpdatePreferencesDTO;
            const prefs = await notificationService.updatePreferences(dto, req.user!);
            ResponseHelper.success(res, prefs, 'Notification preferences updated.');
        } catch (error) {
            next(error);
        }
    };
}

export const notificationController = new NotificationController();
