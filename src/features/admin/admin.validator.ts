import { body, param, query } from 'express-validator';

export const userIdParamValidator = [
    param('id').isUUID().withMessage('User ID must be a valid UUID'),
];

export const groupIdParamValidator = [
    param('id').isUUID().withMessage('Group ID must be a valid UUID'),
];

export const reportIdParamValidator = [
    param('id').isUUID().withMessage('Report ID must be a valid UUID'),
];

export const adminUpdateUserValidator = [
    body('status')
        .exists().withMessage('status is required')
        .isIn(['active', 'suspended', 'banned']).withMessage('status must be active, suspended, or banned'),
];

export const adminVerifyIdValidator = [
    body('decision')
        .exists().withMessage('decision is required')
        .isIn(['approved', 'rejected']).withMessage('decision must be approved or rejected'),

    body('rejection_reason')
        .optional()
        .isString().withMessage('rejection_reason must be a string'),
];

export const adminUpdateGroupValidator = [
    body('status')
        .optional()
        .isIn(['active', 'suspended']).withMessage('status must be active or suspended'),

    body('is_verified')
        .optional()
        .isBoolean().withMessage('is_verified must be a boolean'),
];

export const adminResolveReportValidator = [
    body('action')
        .exists().withMessage('action is required')
        .isIn(['resolved', 'dismissed']).withMessage('action must be resolved or dismissed'),
];

export const adminListUsersValidator = [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    query('status').optional().isString(),
    query('search').optional().isString(),
];

export const adminListGroupsValidator = [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    query('status').optional().isString(),
    query('search').optional().isString(),
];

export const adminListReportsValidator = [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    query('status').optional().isString(),
];

export const adminAuditLogsValidator = [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    query('user_id').optional().isUUID().withMessage('user_id must be a valid UUID'),
    query('action').optional().isString(),
    query('entity_type').optional().isString(),
    query('date_from').optional().isISO8601().withMessage('date_from must be a valid ISO 8601 date'),
    query('date_to').optional().isISO8601().withMessage('date_to must be a valid ISO 8601 date'),
];
