import { body, param, query } from 'express-validator';

export const groupIdParam = [
    param('id').isUUID().withMessage('Group ID must be a valid UUID'),
];

export const postIdParam = [
    param('postId').isUUID().withMessage('Post ID must be a valid UUID'),
];

export const commentIdParam = [
    param('commentId').isUUID().withMessage('Comment ID must be a valid UUID'),
];

export const createPostValidator = [
    body('content')
        .optional({ nullable: true, checkFalsy: true })
        .isString()
        .isLength({ max: 5000 }).withMessage('Content must be at most 5000 characters'),
    body('link_url')
        .optional({ nullable: true, checkFalsy: true })
        .isURL({ protocols: ['https'], require_protocol: true })
        .withMessage('link_url must be a valid HTTPS URL'),
];

export const updatePostValidator = [
    body('content')
        .optional({ nullable: true, checkFalsy: true })
        .isString()
        .isLength({ max: 5000 }).withMessage('Content must be at most 5000 characters'),
    body('link_url')
        .optional({ nullable: true, checkFalsy: true })
        .isURL({ protocols: ['https'], require_protocol: true })
        .withMessage('link_url must be a valid HTTPS URL'),
];

export const listFeedValidator = [
    query('cursor')
        .optional()
        .isUUID().withMessage('cursor must be a valid UUID'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
];

export const createCommentValidator = [
    body('content')
        .exists({ checkFalsy: true }).withMessage('content is required')
        .isString()
        .isLength({ min: 1, max: 2000 }).withMessage('Comment must be between 1 and 2000 characters'),
    body('parent_id')
        .optional({ nullable: true, checkFalsy: true })
        .isUUID().withMessage('parent_id must be a valid UUID'),
];

export const updateCommentValidator = [
    body('content')
        .exists({ checkFalsy: true }).withMessage('content is required')
        .isString()
        .isLength({ min: 1, max: 2000 }).withMessage('Comment must be between 1 and 2000 characters'),
];

export const reactValidator = [
    body('emoji')
        .exists({ checkFalsy: true }).withMessage('emoji is required')
        .isString()
        .isLength({ min: 1, max: 10 }).withMessage('Invalid emoji'),
];
