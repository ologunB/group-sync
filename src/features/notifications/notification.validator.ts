import { body, param, query } from 'express-validator';
import { NOTIFICATION_TYPES } from './notification.types';

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
        .isIn(NOTIFICATION_TYPES)
        .withMessage(`pref_type must be one of: ${NOTIFICATION_TYPES.join(', ')}`),

    // All three channels are optional so a client can mute one without having to
    // restate the other two — the service patches only what it is sent.
    body('preferences.*.push_enabled')
        .optional()
        .isBoolean().withMessage('push_enabled must be a boolean'),

    body('preferences.*.in_app_enabled')
        .optional()
        .isBoolean().withMessage('in_app_enabled must be a boolean'),

    body('preferences.*.email_enabled')
        .optional()
        .isBoolean().withMessage('email_enabled must be a boolean'),

    body('preferences.*')
        .custom((pref: Record<string, unknown>) => {
            if (
                pref.push_enabled === undefined &&
                pref.in_app_enabled === undefined &&
                pref.email_enabled === undefined
            ) {
                throw new Error(
                    'Each preference must set at least one of: push_enabled, in_app_enabled, email_enabled',
                );
            }
            return true;
        }),
];
