"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listApplicationsValidator = exports.upsertGroupFormValidator = exports.createInviteLinkValidator = exports.updateMemberValidator = exports.reviewApplicationValidator = exports.applyToGroupValidator = exports.inviteTokenParamValidator = exports.inviteIdParamValidator = exports.userIdParamValidator = exports.applicationIdParamValidator = exports.groupIdParamValidator = void 0;
const express_validator_1 = require("express-validator");
// ─── Shared param validators ──────────────────────────────────────────────────
exports.groupIdParamValidator = [
    (0, express_validator_1.param)('id')
        .exists({ checkFalsy: true }).withMessage('Group ID is required')
        .isUUID(4).withMessage('Group ID must be a valid UUID'),
];
exports.applicationIdParamValidator = [
    (0, express_validator_1.param)('id')
        .exists({ checkFalsy: true }).withMessage('Application ID is required')
        .isUUID(4).withMessage('Application ID must be a valid UUID'),
];
exports.userIdParamValidator = [
    (0, express_validator_1.param)('userId')
        .exists({ checkFalsy: true }).withMessage('User ID is required')
        .isUUID(4).withMessage('User ID must be a valid UUID'),
];
exports.inviteIdParamValidator = [
    (0, express_validator_1.param)('id')
        .exists({ checkFalsy: true }).withMessage('Invite link ID is required')
        .isUUID(4).withMessage('Invite link ID must be a valid UUID'),
];
exports.inviteTokenParamValidator = [
    (0, express_validator_1.param)('token')
        .exists({ checkFalsy: true }).withMessage('Invite token is required')
        .isString().withMessage('Invite token must be a string')
        .isLength({ min: 1, max: 64 }).withMessage('Invalid invite token format'),
];
// ─── Apply to group ───────────────────────────────────────────────────────────
exports.applyToGroupValidator = [
    (0, express_validator_1.body)('form_responses')
        .optional()
        .isObject().withMessage('form_responses must be an object'),
];
// ─── Review application ───────────────────────────────────────────────────────
exports.reviewApplicationValidator = [
    (0, express_validator_1.body)('action')
        .exists({ checkFalsy: true }).withMessage('action is required')
        .isIn(['approve', 'reject']).withMessage('action must be "approve" or "reject"'),
    (0, express_validator_1.body)('rejection_reason')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('rejection_reason must be a string')
        .isLength({ max: 1000 }).withMessage('rejection_reason must not exceed 1000 characters'),
];
// ─── Update member ────────────────────────────────────────────────────────────
exports.updateMemberValidator = [
    (0, express_validator_1.body)('role')
        .optional()
        .isIn(['admin', 'moderator', 'member'])
        .withMessage('role must be one of: admin, moderator, member'),
    (0, express_validator_1.body)('status')
        .optional()
        .isIn(['active', 'suspended', 'banned'])
        .withMessage('status must be one of: active, suspended, banned'),
];
// ─── Create invite link ───────────────────────────────────────────────────────
exports.createInviteLinkValidator = [
    (0, express_validator_1.body)('max_uses')
        .optional({ nullable: true })
        .isInt({ min: 1 }).withMessage('max_uses must be a positive integer'),
    (0, express_validator_1.body)('expires_in_hours')
        .optional({ nullable: true })
        .isInt({ min: 1, max: 8760 })
        .withMessage('expires_in_hours must be between 1 and 8760 (1 year)'),
];
// ─── Upsert group form ────────────────────────────────────────────────────────
exports.upsertGroupFormValidator = [
    (0, express_validator_1.body)('fields')
        .exists({ checkFalsy: false }).withMessage('fields is required')
        .isArray({ max: 20 }).withMessage('fields must be an array of up to 20 items'),
    (0, express_validator_1.body)('fields.*.id')
        .exists({ checkFalsy: true }).withMessage('Each field must have an id')
        .isString().withMessage('Field id must be a string'),
    (0, express_validator_1.body)('fields.*.type')
        .exists({ checkFalsy: true }).withMessage('Each field must have a type')
        .isIn(['text', 'textarea', 'select', 'checkbox', 'radio'])
        .withMessage('Field type must be: text, textarea, select, checkbox, or radio'),
    (0, express_validator_1.body)('fields.*.label')
        .exists({ checkFalsy: true }).withMessage('Each field must have a label')
        .isString().withMessage('Field label must be a string')
        .isLength({ min: 1, max: 200 }).withMessage('Field label must be 1-200 characters'),
    (0, express_validator_1.body)('fields.*.required')
        .exists().withMessage('Each field must have a required flag')
        .isBoolean().withMessage('required must be a boolean'),
    (0, express_validator_1.body)('fields.*.options')
        .optional()
        .isArray({ max: 20 }).withMessage('options must be an array of up to 20 items'),
    (0, express_validator_1.body)('fields.*.options.*')
        .optional()
        .isString().withMessage('Each option must be a string')
        .isLength({ max: 200 }).withMessage('Each option must not exceed 200 characters'),
];
// ─── Applications list filter ─────────────────────────────────────────────────
exports.listApplicationsValidator = [
    ...exports.groupIdParamValidator,
    (0, express_validator_1.query)('status')
        .optional()
        .isIn(['pending', 'approved', 'rejected', 'withdrawn'])
        .withMessage('status must be one of: pending, approved, rejected, withdrawn'),
    (0, express_validator_1.query)('page')
        .optional()
        .isInt({ min: 1 }).withMessage('page must be a positive integer').toInt(),
    (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50').toInt(),
];
//# sourceMappingURL=membership.validator.js.map