"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePreferencesValidator = exports.listNotificationsValidator = exports.notificationIdParamValidator = void 0;
const express_validator_1 = require("express-validator");
exports.notificationIdParamValidator = [
    (0, express_validator_1.param)('id').isUUID().withMessage('Notification ID must be a valid UUID'),
];
exports.listNotificationsValidator = [
    (0, express_validator_1.query)('cursor').optional().isUUID().withMessage('cursor must be a valid UUID'),
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
    (0, express_validator_1.query)('unread_only').optional().isBoolean().withMessage('unread_only must be a boolean'),
];
exports.updatePreferencesValidator = [
    (0, express_validator_1.body)('preferences')
        .exists().withMessage('preferences is required')
        .isArray({ min: 1 }).withMessage('preferences must be a non-empty array'),
    (0, express_validator_1.body)('preferences.*.group_id')
        .optional({ nullable: true })
        .isUUID().withMessage('group_id must be a valid UUID'),
    (0, express_validator_1.body)('preferences.*.pref_type')
        .exists().withMessage('pref_type is required')
        .isString().withMessage('pref_type must be a string'),
    (0, express_validator_1.body)('preferences.*.push_enabled')
        .exists().withMessage('push_enabled is required')
        .isBoolean().withMessage('push_enabled must be a boolean'),
    (0, express_validator_1.body)('preferences.*.in_app_enabled')
        .exists().withMessage('in_app_enabled is required')
        .isBoolean().withMessage('in_app_enabled must be a boolean'),
];
//# sourceMappingURL=notification.validator.js.map