
import { body, param, query, ValidationChain } from 'express-validator';

// ─── Shared param validators ──────────────────────────────────────────────────

export const groupIdParamValidator: ValidationChain[] = [
    param('id')
        .exists({ checkFalsy: true }).withMessage('Group ID is required')
        .isUUID(4).withMessage('Group ID must be a valid UUID'),
];

export const applicationIdParamValidator: ValidationChain[] = [
    param('id')
        .exists({ checkFalsy: true }).withMessage('Application ID is required')
        .isUUID(4).withMessage('Application ID must be a valid UUID'),
];

export const userIdParamValidator: ValidationChain[] = [
    param('userId')
        .exists({ checkFalsy: true }).withMessage('User ID is required')
        .isUUID(4).withMessage('User ID must be a valid UUID'),
];

export const inviteIdParamValidator: ValidationChain[] = [
    param('id')
        .exists({ checkFalsy: true }).withMessage('Invite link ID is required')
        .isUUID(4).withMessage('Invite link ID must be a valid UUID'),
];

export const inviteTokenParamValidator: ValidationChain[] = [
    param('token')
        .exists({ checkFalsy: true }).withMessage('Invite token is required')
        .isString().withMessage('Invite token must be a string')
        .isLength({ min: 1, max: 64 }).withMessage('Invalid invite token format'),
];

// ─── Apply to group ───────────────────────────────────────────────────────────

export const applyToGroupValidator: ValidationChain[] = [
    body('form_responses')
        .optional()
        .isObject().withMessage('form_responses must be an object'),
];

// ─── Review application ───────────────────────────────────────────────────────

export const reviewApplicationValidator: ValidationChain[] = [
    body('action')
        .exists({ checkFalsy: true }).withMessage('action is required')
        .isIn(['approve', 'reject']).withMessage('action must be "approve" or "reject"'),

    body('rejection_reason')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('rejection_reason must be a string')
        .isLength({ max: 1000 }).withMessage('rejection_reason must not exceed 1000 characters'),
];

// ─── Update member ────────────────────────────────────────────────────────────

export const updateMemberValidator: ValidationChain[] = [
    body('role')
        .optional()
        .isIn(['admin', 'moderator', 'member'])
        .withMessage('role must be one of: admin, moderator, member'),

    body('status')
        .optional()
        .isIn(['active', 'suspended', 'banned'])
        .withMessage('status must be one of: active, suspended, banned'),
];

// ─── Create invite link ───────────────────────────────────────────────────────

export const createInviteLinkValidator: ValidationChain[] = [
    body('max_uses')
        .optional({ nullable: true })
        .isInt({ min: 1 }).withMessage('max_uses must be a positive integer'),

    body('expires_in_hours')
        .optional({ nullable: true })
        .isInt({ min: 1, max: 8760 })
        .withMessage('expires_in_hours must be between 1 and 8760 (1 year)'),
];

// ─── Upsert group form ────────────────────────────────────────────────────────

export const upsertGroupFormValidator: ValidationChain[] = [
    body('fields')
        .exists({ checkFalsy: false }).withMessage('fields is required')
        .isArray({ max: 20 }).withMessage('fields must be an array of up to 20 items'),

    body('fields.*.id')
        .exists({ checkFalsy: true }).withMessage('Each field must have an id')
        .isString().withMessage('Field id must be a string'),

    body('fields.*.type')
        .exists({ checkFalsy: true }).withMessage('Each field must have a type')
        .isIn(['text', 'textarea', 'select', 'checkbox', 'radio'])
        .withMessage('Field type must be: text, textarea, select, checkbox, or radio'),

    body('fields.*.label')
        .exists({ checkFalsy: true }).withMessage('Each field must have a label')
        .isString().withMessage('Field label must be a string')
        .isLength({ min: 1, max: 200 }).withMessage('Field label must be 1-200 characters'),

    body('fields.*.required')
        .exists().withMessage('Each field must have a required flag')
        .isBoolean().withMessage('required must be a boolean'),

    body('fields.*.options')
        .optional()
        .isArray({ max: 20 }).withMessage('options must be an array of up to 20 items'),

    body('fields.*.options.*')
        .optional()
        .isString().withMessage('Each option must be a string')
        .isLength({ max: 200 }).withMessage('Each option must not exceed 200 characters'),
];

// ─── Applications list filter ─────────────────────────────────────────────────

export const listApplicationsValidator: ValidationChain[] = [
    ...groupIdParamValidator,

    query('status')
        .optional()
        .isIn(['pending', 'approved', 'rejected', 'withdrawn'])
        .withMessage('status must be one of: pending, approved, rejected, withdrawn'),

    query('page')
        .optional()
        .isInt({ min: 1 }).withMessage('page must be a positive integer').toInt(),

    query('limit')
        .optional()
        .isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50').toInt(),
];
