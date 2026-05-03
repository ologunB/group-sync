"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memberSearchValidator = exports.groupSlugParamValidator = exports.groupIdParamValidator = exports.listGroupsValidator = exports.updateGroupValidator = exports.createGroupValidator = void 0;
const express_validator_1 = require("express-validator");
const MEMBERSHIP_TYPES = ['open', 'application', 'invite_only'];
const FEE_FREQUENCIES = ['one_time', 'monthly', 'yearly'];
const SORT_OPTIONS = ['relevance', 'distance', 'newest', 'most_members'];
// ─── Create group ─────────────────────────────────────────────────────────────
exports.createGroupValidator = [
    (0, express_validator_1.body)('name')
        .exists({ checkFalsy: true }).withMessage('Group name is required')
        .isString().withMessage('Group name must be a string')
        .trim()
        .isLength({ min: 2, max: 150 }).withMessage('Group name must be between 2 and 150 characters'),
    (0, express_validator_1.body)('category')
        .exists({ checkFalsy: true }).withMessage('Category is required')
        .isString().withMessage('Category must be a string')
        .trim()
        .isLength({ min: 1, max: 80 }).withMessage('Category must not exceed 80 characters'),
    (0, express_validator_1.body)('subcategory')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Subcategory must be a string')
        .trim()
        .isLength({ max: 80 }).withMessage('Subcategory must not exceed 80 characters'),
    (0, express_validator_1.body)('description')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Description must be a string')
        .trim(),
    (0, express_validator_1.body)('city')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('City must be a string')
        .trim()
        .isLength({ max: 100 }).withMessage('City must not exceed 100 characters'),
    (0, express_validator_1.body)('state')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('State must be a string')
        .trim()
        .isLength({ max: 100 }).withMessage('State must not exceed 100 characters'),
    (0, express_validator_1.body)('country')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Country must be a string')
        .trim()
        .isLength({ max: 100 }).withMessage('Country must not exceed 100 characters'),
    (0, express_validator_1.body)('lat')
        .optional({ nullable: true })
        .isFloat({ min: -90, max: 90 })
        .withMessage('Latitude must be between -90 and 90'),
    (0, express_validator_1.body)('lng')
        .optional({ nullable: true })
        .isFloat({ min: -180, max: 180 })
        .withMessage('Longitude must be between -180 and 180'),
    (0, express_validator_1.body)('membership_type')
        .optional()
        .isIn(MEMBERSHIP_TYPES)
        .withMessage(`membership_type must be one of: ${MEMBERSHIP_TYPES.join(', ')}`),
    (0, express_validator_1.body)('membership_fee')
        .optional({ nullable: true })
        .isFloat({ min: 0 })
        .withMessage('membership_fee must be a positive number'),
    (0, express_validator_1.body)('membership_fee_currency')
        .optional({ nullable: true, checkFalsy: true })
        .isString()
        .isLength({ max: 10 })
        .withMessage('membership_fee_currency must be a valid currency code'),
    (0, express_validator_1.body)('membership_fee_frequency')
        .optional({ nullable: true })
        .isIn(FEE_FREQUENCIES)
        .withMessage(`membership_fee_frequency must be one of: ${FEE_FREQUENCIES.join(', ')}`),
    (0, express_validator_1.body)('how_to_join_content')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('how_to_join_content must be a string'),
    (0, express_validator_1.body)('rules')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('rules must be a string'),
    (0, express_validator_1.body)('cover_image_url')
        .optional({ nullable: true, checkFalsy: true })
        .isURL({ protocols: ['https'], require_protocol: true })
        .withMessage('cover_image_url must be a valid HTTPS URL'),
    (0, express_validator_1.body)('logo_url')
        .optional({ nullable: true, checkFalsy: true })
        .isURL({ protocols: ['https'], require_protocol: true })
        .withMessage('logo_url must be a valid HTTPS URL'),
    (0, express_validator_1.body)('founding_date')
        .optional({ nullable: true, checkFalsy: true })
        .isISO8601().withMessage('founding_date must be a valid ISO8601 date (YYYY-MM-DD)'),
];
// ─── Update group (all optional, same rules) ──────────────────────────────────
exports.updateGroupValidator = exports.createGroupValidator.map((chain) => chain.optional ? chain : chain);
// ─── List groups (query params) ───────────────────────────────────────────────
exports.listGroupsValidator = [
    (0, express_validator_1.query)('q')
        .optional({ checkFalsy: true })
        .isString().withMessage('q must be a string')
        .isLength({ max: 200 }).withMessage('Search query must not exceed 200 characters'),
    (0, express_validator_1.query)('category')
        .optional({ checkFalsy: true })
        .isString().withMessage('category must be a string'),
    (0, express_validator_1.query)('subcategory')
        .optional({ checkFalsy: true })
        .isString().withMessage('subcategory must be a string'),
    (0, express_validator_1.query)('city')
        .optional({ checkFalsy: true })
        .isString().withMessage('city must be a string'),
    (0, express_validator_1.query)('state')
        .optional({ checkFalsy: true })
        .isString().withMessage('state must be a string'),
    (0, express_validator_1.query)('country')
        .optional({ checkFalsy: true })
        .isString().withMessage('country must be a string'),
    (0, express_validator_1.query)('lat')
        .optional()
        .isFloat({ min: -90, max: 90 }).withMessage('lat must be between -90 and 90'),
    (0, express_validator_1.query)('lng')
        .optional()
        .isFloat({ min: -180, max: 180 }).withMessage('lng must be between -180 and 180'),
    (0, express_validator_1.query)('radius_km')
        .optional()
        .isFloat({ min: 0.1, max: 500 }).withMessage('radius_km must be between 0.1 and 500'),
    (0, express_validator_1.query)('membership_type')
        .optional()
        .isIn(MEMBERSHIP_TYPES).withMessage(`membership_type must be one of: ${MEMBERSHIP_TYPES.join(', ')}`),
    (0, express_validator_1.query)('min_members')
        .optional()
        .isInt({ min: 0 }).withMessage('min_members must be a non-negative integer').toInt(),
    (0, express_validator_1.query)('max_members')
        .optional()
        .isInt({ min: 1 }).withMessage('max_members must be a positive integer').toInt(),
    (0, express_validator_1.query)('is_verified')
        .optional()
        .isBoolean().withMessage('is_verified must be true or false').toBoolean(),
    (0, express_validator_1.query)('sort')
        .optional()
        .isIn(SORT_OPTIONS).withMessage(`sort must be one of: ${SORT_OPTIONS.join(', ')}`),
    (0, express_validator_1.query)('page')
        .optional()
        .isInt({ min: 1 }).withMessage('page must be a positive integer').toInt(),
    (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50').toInt(),
];
// ─── UUID param validators ────────────────────────────────────────────────────
exports.groupIdParamValidator = [
    (0, express_validator_1.param)('id')
        .exists({ checkFalsy: true }).withMessage('Group ID is required')
        .isUUID(4).withMessage('Group ID must be a valid UUID'),
];
exports.groupSlugParamValidator = [
    (0, express_validator_1.param)('slug')
        .exists({ checkFalsy: true }).withMessage('Group slug is required')
        .isString().withMessage('Group slug must be a string')
        .isLength({ min: 1, max: 170 }).withMessage('Invalid slug format'),
];
exports.memberSearchValidator = [
    ...exports.groupIdParamValidator,
    (0, express_validator_1.query)('page')
        .optional()
        .isInt({ min: 1 }).withMessage('page must be a positive integer').toInt(),
    (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50').toInt(),
    (0, express_validator_1.query)('role')
        .optional()
        .isIn(['super_admin', 'admin', 'moderator', 'member'])
        .withMessage('role must be one of: super_admin, admin, moderator, member'),
    (0, express_validator_1.query)('search')
        .optional({ checkFalsy: true })
        .isString().withMessage('search must be a string')
        .isLength({ max: 100 }).withMessage('search must not exceed 100 characters'),
];
//# sourceMappingURL=group.validator.js.map