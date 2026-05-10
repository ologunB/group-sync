"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../shared/middleware/auth.middleware");
const validators_1 = require("../../shared/utils/validators");
const notification_controller_1 = require("./notification.controller");
const notification_validator_1 = require("./notification.validator");
const router = (0, express_1.Router)();
// Preferences routes must be defined before /:id routes to avoid param collision
router.get('/preferences', auth_middleware_1.authenticate, notification_controller_1.notificationController.getPreferences);
router.patch('/preferences', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(notification_validator_1.updatePreferencesValidator), notification_controller_1.notificationController.updatePreferences);
router.get('/', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(notification_validator_1.listNotificationsValidator), notification_controller_1.notificationController.list);
router.patch('/read-all', auth_middleware_1.authenticate, notification_controller_1.notificationController.markAllRead);
router.patch('/:id/read', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(notification_validator_1.notificationIdParamValidator), notification_controller_1.notificationController.markRead);
router.delete('/:id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(notification_validator_1.notificationIdParamValidator), notification_controller_1.notificationController.deleteNotification);
exports.default = router;
//# sourceMappingURL=notification.routes.js.map