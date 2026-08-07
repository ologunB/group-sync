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
    query('review_status')
        .optional()
        .isIn(['pending', 'approved', 'rejected'])
        .withMessage('review_status must be pending, approved, or rejected'),
];

export const adminReviewGroupValidator = [
    body('decision')
        .exists().withMessage('decision is required')
        .isIn(['approve', 'reject']).withMessage('decision must be approve or reject'),

    // Required in practice when rejecting — enforced in the service, which is where the
    // decision value and the notes can be checked against each other.
    body('notes')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('notes must be a string')
        .trim()
        .isLength({ max: 1000 }).withMessage('notes must be 1000 characters or fewer'),
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

export const adminChangeRoleValidator = [
    body('role')
        .exists().withMessage('role is required')
        .isIn(['user', 'admin', 'super_admin']).withMessage('role must be user, admin, or super_admin'),
];

// ─── Taxonomy ─────────────────────────────────────────────────────────────────

export const taxonomyIdParamValidator = [
    param('id').isUUID().withMessage('ID must be a valid UUID'),
];

export const adminListTaxonomyValidator = [
    query('include_inactive')
        .optional()
        .isBoolean().withMessage('include_inactive must be a boolean'),
];

export const adminCreateCategoryValidator = [
    // `value` is what gets written to groups.category, so it is the one field that must
    // be present and is never editable afterwards.
    body('value')
        .exists({ checkFalsy: true }).withMessage('value is required')
        .isString().withMessage('value must be a string')
        .trim()
        .isLength({ min: 2, max: 80 }).withMessage('value must be between 2 and 80 characters'),

    body('label')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('label must be a string')
        .trim()
        .isLength({ max: 80 }).withMessage('label must be 80 characters or fewer'),

    body('sort_order')
        .optional()
        .isInt({ min: 0 }).withMessage('sort_order must be a non-negative integer'),

    body('is_active')
        .optional()
        .isBoolean().withMessage('is_active must be a boolean'),
];

export const adminUpdateCategoryValidator = [
    body('label')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('label must be a string')
        .trim()
        .isLength({ min: 1, max: 80 }).withMessage('label must be between 1 and 80 characters'),

    body('sort_order')
        .optional()
        .isInt({ min: 0 }).withMessage('sort_order must be a non-negative integer'),

    body('is_active')
        .optional()
        .isBoolean().withMessage('is_active must be a boolean'),
];

export const adminCreateInterestValidator = [
    body('value')
        .exists({ checkFalsy: true }).withMessage('value is required')
        .isString().withMessage('value must be a string')
        .trim()
        .isLength({ min: 2, max: 80 }).withMessage('value must be between 2 and 80 characters'),

    body('group')
        .exists({ checkFalsy: true }).withMessage('group is required')
        .isString().withMessage('group must be a string')
        .trim()
        .isLength({ min: 2, max: 80 }).withMessage('group must be between 2 and 80 characters'),

    body('label')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('label must be a string')
        .trim()
        .isLength({ max: 80 }).withMessage('label must be 80 characters or fewer'),

    body('sort_order')
        .optional()
        .isInt({ min: 0 }).withMessage('sort_order must be a non-negative integer'),

    body('is_active')
        .optional()
        .isBoolean().withMessage('is_active must be a boolean'),
];

export const adminUpdateInterestValidator = [
    body('label')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('label must be a string')
        .trim()
        .isLength({ min: 1, max: 80 }).withMessage('label must be between 1 and 80 characters'),

    body('group')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('group must be a string')
        .trim()
        .isLength({ min: 2, max: 80 }).withMessage('group must be between 2 and 80 characters'),

    body('sort_order')
        .optional()
        .isInt({ min: 0 }).withMessage('sort_order must be a non-negative integer'),

    body('is_active')
        .optional()
        .isBoolean().withMessage('is_active must be a boolean'),
];

// ─── Event moderation ─────────────────────────────────────────────────────────

export const eventIdParamValidator = [
    param('id').isUUID().withMessage('Event ID must be a valid UUID'),
];

export const adminListEventsValidator = [
    query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50'),
    query('status')
        .optional()
        .isIn(['scheduled', 'cancelled', 'completed'])
        .withMessage('status must be scheduled, cancelled or completed'),
    query('when')
        .optional()
        .isIn(['upcoming', 'past']).withMessage('when must be upcoming or past'),
    query('search').optional().isString().withMessage('search must be a string'),
];

export const adminCancelEventValidator = [
    // Cancelling fans a notification out to everyone who RSVP'd, and they are shown this
    // verbatim — an unexplained cancellation is worse than none.
    body('reason')
        .exists({ checkFalsy: true }).withMessage('reason is required')
        .isString().withMessage('reason must be a string')
        .trim()
        .isLength({ min: 5, max: 500 }).withMessage('reason must be between 5 and 500 characters'),
];
