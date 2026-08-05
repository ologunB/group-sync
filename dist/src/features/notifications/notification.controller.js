"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationController = exports.NotificationController = void 0;
const response_helper_1 = require("../../shared/utils/response.helper");
const notification_service_1 = require("./notification.service");
class NotificationController {
    list = async (req, res, next) => {
        try {
            const query = {
                cursor: req.query.cursor,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
                unread_only: req.query.unread_only === 'true',
            };
            const result = await notification_service_1.notificationService.listNotifications(query, req.user);
            response_helper_1.ResponseHelper.success(res, result, 'Notifications retrieved successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // GET /notifications/unread-count — cheap endpoint for the badge.
    unreadCount = async (req, res, next) => {
        try {
            const result = await notification_service_1.notificationService.getUnreadCount(req.user);
            response_helper_1.ResponseHelper.success(res, result, 'Unread count retrieved successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    markRead = async (req, res, next) => {
        try {
            const notification = await notification_service_1.notificationService.markRead(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, notification, 'Notification marked as read.');
        }
        catch (error) {
            next(error);
        }
    };
    markAllRead = async (req, res, next) => {
        try {
            const result = await notification_service_1.notificationService.markAllRead(req.user);
            response_helper_1.ResponseHelper.success(res, result, 'All notifications marked as read.');
        }
        catch (error) {
            next(error);
        }
    };
    deleteNotification = async (req, res, next) => {
        try {
            await notification_service_1.notificationService.deleteNotification(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Notification deleted.');
        }
        catch (error) {
            next(error);
        }
    };
    getPreferences = async (req, res, next) => {
        try {
            const prefs = await notification_service_1.notificationService.getPreferences(req.user);
            response_helper_1.ResponseHelper.success(res, prefs, 'Notification preferences retrieved.');
        }
        catch (error) {
            next(error);
        }
    };
    updatePreferences = async (req, res, next) => {
        try {
            const dto = req.body;
            const prefs = await notification_service_1.notificationService.updatePreferences(dto, req.user);
            response_helper_1.ResponseHelper.success(res, prefs, 'Notification preferences updated.');
        }
        catch (error) {
            next(error);
        }
    };
}
exports.NotificationController = NotificationController;
exports.notificationController = new NotificationController();
//# sourceMappingURL=notification.controller.js.map