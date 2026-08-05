"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updatePreferencesValidator = exports.listNotificationsValidator = exports.notificationIdParamValidator = void 0;
const express_validator_1 = require("express-validator");
const notification_types_1 = require("./notification.types");
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
        .isIn(notification_types_1.NOTIFICATION_TYPES)
        .withMessage(`pref_type must be one of: ${notification_types_1.NOTIFICATION_TYPES.join(', ')}`),
    // All three channels are optional so a client can mute one without having to
    // restate the other two — the service patches only what it is sent.
    (0, express_validator_1.body)('preferences.*.push_enabled')
        .optional()
        .isBoolean().withMessage('push_enabled must be a boolean'),
    (0, express_validator_1.body)('preferences.*.in_app_enabled')
        .optional()
        .isBoolean().withMessage('in_app_enabled must be a boolean'),
    (0, express_validator_1.body)('preferences.*.email_enabled')
        .optional()
        .isBoolean().withMessage('email_enabled must be a boolean'),
    (0, express_validator_1.body)('preferences.*')
        .custom((pref) => {
        if (pref.push_enabled === undefined &&
            pref.in_app_enabled === undefined &&
            pref.email_enabled === undefined) {
            throw new Error('Each preference must set at least one of: push_enabled, in_app_enabled, email_enabled');
        }
        return true;
    }),
];
//# sourceMappingURL=notification.validator.js.map