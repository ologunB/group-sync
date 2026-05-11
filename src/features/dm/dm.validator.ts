import { body, query } from 'express-validator';

export const sendDmValidator = [
    body('content')
        .optional({ nullable: true })
        .isString().withMessage('Content must be a string')
        .isLength({ max: 4000 }).withMessage('Content must be at most 4000 characters'),
    body('media_url')
        .optional({ nullable: true })
        .isURL().withMessage('media_url must be a valid URL'),
];

export const listThreadValidator = [
    query('cursor')
        .optional()
        .isUUID().withMessage('cursor must be a UUID'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
];
