import { body, param, query } from 'express-validator';

export const notificationIdParamValidator = [
    param('id').isUUID().withMessage('Notification ID must be a valid UUID'),
];

export const listNotificationsValidator = [
    query('cursor').optional().isUUID().withMessage('cursor must be a valid UUID'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
    query('unread_only').optional().isBoolean().withMessage('unread_only must be a boolean'),
];

export const updatePreferencesValidator = [
    body('preferences')
        .exists().withMessage('preferences is required')
        .isArray({ min: 1 }).withMessage('preferences must be a non-empty array'),

    body('preferences.*.group_id')
        .optional({ nullable: true })
        .isUUID().withMessage('group_id must be a valid UUID'),

    body('preferences.*.pref_type')
        .exists().withMessage('pref_type is required')
        .isString().withMessage('pref_type must be a string'),

    body('preferences.*.push_enabled')
        .exists().withMessage('push_enabled is required')
        .isBoolean().withMessage('push_enabled must be a boolean'),

    body('preferences.*.in_app_enabled')
        .exists().withMessage('in_app_enabled is required')
        .isBoolean().withMessage('in_app_enabled must be a boolean'),
];
