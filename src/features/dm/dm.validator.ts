import { body, query } from 'express-validator';

export const sendDmValidator = [
    body('content')
        .optional({ nullable: true })
        .isString().withMessage('Content must be a string')
        .isLength({ max: 4000 }).withMessage('Content must be at most 4000 characters'),
    body('message_type')
        .optional()
        .isIn(['text', 'image', 'file', 'voice_note'])
        .withMessage('Invalid message type'),
    body('media_url')
        .optional({ nullable: true })
        .isURL().withMessage('media_url must be a valid URL'),
    body('reply_to_id')
        .optional({ nullable: true })
        .isUUID().withMessage('reply_to_id must be a UUID'),
];

export const listThreadValidator = [
    query('cursor')
        .optional()
        .isUUID().withMessage('cursor must be a UUID'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
];

export const listConversationsValidator = [
    query('type')
        .optional()
        .isIn(['dm', 'group']).withMessage("type must be either 'dm' or 'group'"),
];

export const dmReactionValidator = [
    body('emoji')
        .exists().withMessage('emoji is required')
        .isString().isLength({ min: 1, max: 10 }).withMessage('Invalid emoji'),
];
