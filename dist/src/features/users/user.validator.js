"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.myApplicationsValidator = exports.paginationValidator = exports.userIdParamValidator = exports.updateInterestsValidator = exports.updateProfileValidator = void 0;
const express_validator_1 = require("express-validator");
// ─── Update profile ───────────────────────────────────────────────────────────
exports.updateProfileValidator = [
    (0, express_validator_1.body)('display_name')
        .optional()
        .isString().withMessage('Display name must be a string')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Display name must be between 2 and 100 characters'),
    (0, express_validator_1.body)('username')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Username must be a string')
        .trim()
        .isLength({ min: 3, max: 50 })
        .withMessage('Username must be between 3 and 50 characters')
        .matches(/^[a-z0-9_]+$/)
        .withMessage('Username may only contain lowercase letters, numbers, and underscores'),
    (0, express_validator_1.body)('bio')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Bio must be a string')
        .trim()
        .isLength({ max: 500 })
        .withMessage('Bio must not exceed 500 characters'),
    (0, express_validator_1.body)('city')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('City must be a string')
        .trim()
        .isLength({ max: 100 })
        .withMessage('City must not exceed 100 characters'),
    (0, express_validator_1.body)('state')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('State must be a string')
        .trim()
        .isLength({ max: 100 })
        .withMessage('State must not exceed 100 characters'),
    (0, express_validator_1.body)('country')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Country must be a string')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Country must be between 2 and 100 characters'),
    (0, express_validator_1.body)('lat')
        .optional({ nullable: true })
        .isFloat({ min: -90, max: 90 })
        .withMessage('Latitude must be a number between -90 and 90'),
    (0, express_validator_1.body)('lng')
        .optional({ nullable: true })
        .isFloat({ min: -180, max: 180 })
        .withMessage('Longitude must be a number between -180 and 180'),
    (0, express_validator_1.body)('profile_photo_url')
        .optional({ nullable: true, checkFalsy: true })
        .isURL({ protocols: ['https'], require_protocol: true })
        .withMessage('Profile photo URL must be a valid HTTPS URL'),
    (0, express_validator_1.body)('preferred_language')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Preferred language must be a string')
        .isLength({ min: 2, max: 10 })
        .withMessage('Preferred language must be a valid language code (e.g. en, fr, yo)'),
];
// ─── Update interests ─────────────────────────────────────────────────────────
exports.updateInterestsValidator = [
    (0, express_validator_1.body)('interests')
        .exists({ checkFalsy: false }).withMessage('interests is required')
        .isArray({ max: 30 })
        .withMessage('interests must be an array of up to 30 items'),
    (0, express_validator_1.body)('interests.*')
        .isString().withMessage('Each interest must be a string')
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Each interest tag must be between 1 and 50 characters'),
];
// ─── Get user by ID (param) ───────────────────────────────────────────────────
exports.userIdParamValidator = [
    (0, express_validator_1.param)('id')
        .exists({ checkFalsy: true }).withMessage('User ID is required')
        .isUUID(4).withMessage('User ID must be a valid UUID'),
];
// ─── Pagination query (shared) ────────────────────────────────────────────────
exports.paginationValidator = [
    (0, express_validator_1.query)('page')
        .optional()
        .isInt({ min: 1 }).withMessage('page must be a positive integer')
        .toInt(),
    (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 50 }).withMessage('limit must be between 1 and 50')
        .toInt(),
];
// ─── Application list filter ──────────────────────────────────────────────────
exports.myApplicationsValidator = [
    ...exports.paginationValidator,
    (0, express_validator_1.query)('status')
        .optional()
        .isIn(['pending', 'approved', 'rejected', 'withdrawn'])
        .withMessage('status must be one of: pending, approved, rejected, withdrawn'),
];
//# sourceMappingURL=user.validator.js.map