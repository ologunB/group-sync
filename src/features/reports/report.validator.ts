import { body } from 'express-validator';
import { REPORT_TARGET_TYPES, REPORT_REASONS } from './report.types';

export const submitReportValidator = [
    body('target_type')
        .exists().withMessage('target_type is required')
        .isIn(REPORT_TARGET_TYPES).withMessage(`target_type must be one of: ${REPORT_TARGET_TYPES.join(', ')}`),

    body('target_id')
        .exists().withMessage('target_id is required')
        .isUUID().withMessage('target_id must be a valid UUID'),

    body('reason')
        .exists().withMessage('reason is required')
        .isIn(REPORT_REASONS).withMessage(`reason must be one of: ${REPORT_REASONS.join(', ')}`),

    body('description')
        .optional()
        .isString().withMessage('description must be a string')
        .isLength({ max: 1000 }).withMessage('description must be 1000 characters or fewer'),
];
