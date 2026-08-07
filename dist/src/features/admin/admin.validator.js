"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminCancelEventValidator = exports.adminListEventsValidator = exports.eventIdParamValidator = exports.adminUpdateInterestValidator = exports.adminCreateInterestValidator = exports.adminUpdateCategoryValidator = exports.adminCreateCategoryValidator = exports.adminListTaxonomyValidator = exports.taxonomyIdParamValidator = exports.adminChangeRoleValidator = exports.adminAuditLogsValidator = exports.adminListReportsValidator = exports.adminReviewGroupValidator = exports.adminListGroupsValidator = exports.adminListUsersValidator = exports.adminResolveReportValidator = exports.adminUpdateGroupValidator = exports.adminVerifyIdValidator = exports.adminUpdateUserValidator = exports.reportIdParamValidator = exports.groupIdParamValidator = exports.userIdParamValidator = void 0;
const express_validator_1 = require("express-validator");
exports.userIdParamValidator = [
    (0, express_validator_1.param)('id').isUUID().withMessage('User ID must be a valid UUID'),
];
exports.groupIdParamValidator = [
    (0, express_validator_1.param)('id').isUUID().withMessage('Group ID must be a valid UUID'),
];
exports.reportIdParamValidator = [
    (0, express_validator_1.param)('id').isUUID().withMessage('Report ID must be a valid UUID'),
];
exports.adminUpdateUserValidator = [
    (0, express_validator_1.body)('status')
        .exists().withMessage('status is required')
        .isIn(['active', 'suspended', 'banned']).withMessage('status must be active, suspended, or banned'),
];
exports.adminVerifyIdValidator = [
    (0, express_validator_1.body)('decision')
        .exists().withMessage('decision is required')
        .isIn(['approved', 'rejected']).withMessage('decision must be approved or rejected'),
    (0, express_validator_1.body)('rejection_reason')
        .optional()
        .isString().withMessage('rejection_reason must be a string'),
];
exports.adminUpdateGroupValidator = [
    (0, express_validator_1.body)('status')
        .optional()
        .isIn(['active', 'suspended']).withMessage('status must be active or suspended'),
    (0, express_validator_1.body)('is_verified')
        .optional()
        .isBoolean().withMessage('is_verified must be a boolean'),
];
exports.adminResolveReportValidator = [
    (0, express_validator_1.body)('action')
        .exists().withMessage('action is required')
        .isIn(['resolved', 'dismissed']).withMessage('action must be resolved or dismissed'),
];
exports.adminListUsersValidator = [
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    (0, express_validator_1.query)('status').optional().isString(),
    (0, express_validator_1.query)('search').optional().isString(),
];
exports.adminListGroupsValidator = [
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    (0, express_validator_1.query)('status').optional().isString(),
    (0, express_validator_1.query)('search').optional().isString(),
    (0, express_validator_1.query)('review_status')
        .optional()
        .isIn(['pending', 'approved', 'rejected'])
        .withMessage('review_status must be pending, approved, or rejected'),
];
exports.adminReviewGroupValidator = [
    (0, express_validator_1.body)('decision')
        .exists().withMessage('decision is required')
        .isIn(['approve', 'reject']).withMessage('decision must be approve or reject'),
    // Required in practice when rejecting — enforced in the service, which is where the
    // decision value and the notes can be checked against each other.
    (0, express_validator_1.body)('notes')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('notes must be a string')
        .trim()
        .isLength({ max: 1000 }).withMessage('notes must be 1000 characters or fewer'),
];
exports.adminListReportsValidator = [
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    (0, express_validator_1.query)('status').optional().isString(),
];
exports.adminAuditLogsValidator = [
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    (0, express_validator_1.query)('user_id').optional().isUUID().withMessage('user_id must be a valid UUID'),
    (0, express_validator_1.query)('action').optional().isString(),
    (0, express_validator_1.query)('entity_type').optional().isString(),
    (0, express_validator_1.query)('date_from').optional().isISO8601().withMessage('date_from must be a valid ISO 8601 date'),
    (0, express_validator_1.query)('date_to').optional().isISO8601().withMessage('date_to must be a valid ISO 8601 date'),
];
exports.adminChangeRoleValidator = [
    (0, express_validator_1.body)('role')
        .exists().withMessage('role is required')
        .isIn(['user', 'admin', 'super_admin']).withMessage('role must be user, admin, or super_admin'),
];
// ─── Taxonomy ─────────────────────────────────────────────────────────────────
exports.taxonomyIdParamValidator = [
    (0, express_validator_1.param)('id').isUUID().withMessage('ID must be a valid UUID'),
];
exports.adminListTaxonomyValidator = [
    (0, express_validator_1.query)('include_inactive')
        .optional()
        .isBoolean().withMessage('include_inactive must be a boolean'),
];
exports.adminCreateCategoryValidator = [
    // `value` is what gets written to groups.category, so it is the one field that must
    // be present and is never editable afterwards.
    (0, express_validator_1.body)('value')
        .exists({ checkFalsy: true }).withMessage('value is required')
        .isString().withMessage('value must be a string')
        .trim()
        .isLength({ min: 2, max: 80 }).withMessage('value must be between 2 and 80 characters'),
    (0, express_validator_1.body)('label')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('label must be a string')
        .trim()
        .isLength({ max: 80 }).withMessage('label must be 80 characters or fewer'),
    (0, express_validator_1.body)('sort_order')
        .optional()
        .isInt({ min: 0 }).withMessage('sort_order must be a non-negative integer'),
    (0, express_validator_1.body)('is_active')
        .optional()
        .isBoolean().withMessage('is_active must be a boolean'),
];
exports.adminUpdateCategoryValidator = [
    (0, express_validator_1.body)('label')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('label must be a string')
        .trim()
        .isLength({ min: 1, max: 80 }).withMessage('label must be between 1 and 80 characters'),
    (0, express_validator_1.body)('sort_order')
        .optional()
        .isInt({ min: 0 }).withMessage('sort_order must be a non-negative integer'),
    (0, express_validator_1.body)('is_active')
        .optional()
        .isBoolean().withMessage('is_active must be a boolean'),
];
exports.adminCreateInterestValidator = [
    (0, express_validator_1.body)('value')
        .exists({ checkFalsy: true }).withMessage('value is required')
        .isString().withMessage('value must be a string')
        .trim()
        .isLength({ min: 2, max: 80 }).withMessage('value must be between 2 and 80 characters'),
    (0, express_validator_1.body)('group')
        .exists({ checkFalsy: true }).withMessage('group is required')
        .isString().withMessage('group must be a string')
        .trim()
        .isLength({ min: 2, max: 80 }).withMessage('group must be between 2 and 80 characters'),
    (0, express_validator_1.body)('label')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('label must be a string')
        .trim()
        .isLength({ max: 80 }).withMessage('label must be 80 characters or fewer'),
    (0, express_validator_1.body)('sort_order')
        .optional()
        .isInt({ min: 0 }).withMessage('sort_order must be a non-negative integer'),
    (0, express_validator_1.body)('is_active')
        .optional()
        .isBoolean().withMessage('is_active must be a boolean'),
];
exports.adminUpdateInterestValidator = [
    (0, express_validator_1.body)('label')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('label must be a string')
        .trim()
        .isLength({ min: 1, max: 80 }).withMessage('label must be between 1 and 80 characters'),
    (0, express_validator_1.body)('group')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('group must be a string')
        .trim()
        .isLength({ min: 2, max: 80 }).withMessage('group must be between 2 and 80 characters'),
    (0, express_validator_1.body)('sort_order')
        .optional()
        .isInt({ min: 0 }).withMessage('sort_order must be a non-negative integer'),
    (0, express_validator_1.body)('is_active')
        .optional()
        .isBoolean().withMessage('is_active must be a boolean'),
];
// ─── Event moderation ─────────────────────────────────────────────────────────
exports.eventIdParamValidator = [
    (0, express_validator_1.param)('id').isUUID().withMessage('Event ID must be a valid UUID'),
];
exports.adminListEventsValidator = [
    (0, express_validator_1.query)('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    (0, express_validator_1.query)('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
    (0, express_validator_1.query)('status')
        .optional()
        .isIn(['scheduled', 'cancelled', 'completed'])
        .withMessage('status must be scheduled, cancelled or completed'),
    (0, express_validator_1.query)('when')
        .optional()
        .isIn(['upcoming', 'past']).withMessage('when must be upcoming or past'),
    (0, express_validator_1.query)('search').optional().isString().withMessage('search must be a string'),
];
exports.adminCancelEventValidator = [
    // Cancelling fans a notification out to everyone who RSVP'd, and they are shown this
    // verbatim — an unexplained cancellation is worse than none.
    (0, express_validator_1.body)('reason')
        .exists({ checkFalsy: true }).withMessage('reason is required')
        .isString().withMessage('reason must be a string')
        .trim()
        .isLength({ min: 5, max: 500 }).withMessage('reason must be between 5 and 500 characters'),
];
//# sourceMappingURL=admin.validator.js.map