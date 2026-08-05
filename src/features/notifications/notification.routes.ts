import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { validateRequest } from '../../shared/utils/validators';
import { notificationController } from './notification.controller';
import {
    notificationIdParamValidator,
    listNotificationsValidator,
    updatePreferencesValidator,
} from './notification.validator';

const router = Router();

// Literal paths must be defined before /:id routes to avoid param collision
router.get('/unread-count', authenticate, notificationController.unreadCount);
router.get('/preferences', authenticate, notificationController.getPreferences);
router.patch('/preferences', authenticate, validateRequest(updatePreferencesValidator), notificationController.updatePreferences);

router.get('/', authenticate, validateRequest(listNotificationsValidator), notificationController.list);
router.patch('/read-all', authenticate, notificationController.markAllRead);
router.patch('/:id/read', authenticate, validateRequest(notificationIdParamValidator), notificationController.markRead);
router.delete('/:id', authenticate, validateRequest(notificationIdParamValidator), notificationController.deleteNotification);

export default router;
