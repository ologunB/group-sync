import { body, query } from 'express-validator';

export const sendMessageValidator = [
    body('content')
        .optional({ nullable: true })
        .isString().withMessage('Content must be a string')
        .isLength({ max: 4000 }).withMessage('Content must be at most 4000 characters'),
    body('message_type')
        .optional()
        .isIn(['text', 'image', 'audio', 'poll'])
        .withMessage('Invalid message type'),
    body('media_url')
        .optional({ nullable: true })
        .isURL().withMessage('media_url must be a valid URL'),
    body('reply_to_id')
        .optional({ nullable: true })
        .isUUID().withMessage('reply_to_id must be a UUID'),
];

export const listMessagesValidator = [
    query('cursor')
        .optional()
        .isUUID().withMessage('cursor must be a UUID'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    query('direction')
        .optional()
        .isIn(['before', 'after']).withMessage("direction must be 'before' or 'after'"),
];

export const toggleChatLockValidator = [
    body('locked')
        .exists().withMessage('locked is required')
        .isBoolean().withMessage('locked must be a boolean'),
];

export const votePollValidator = [
    body('option_id')
        .exists().withMessage('option_id is required')
        .isUUID().withMessage('option_id must be a UUID'),
];
