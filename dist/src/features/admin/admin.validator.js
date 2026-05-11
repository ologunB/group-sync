"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminChangeRoleValidator = exports.adminAuditLogsValidator = exports.adminListReportsValidator = exports.adminListGroupsValidator = exports.adminListUsersValidator = exports.adminResolveReportValidator = exports.adminUpdateGroupValidator = exports.adminVerifyIdValidator = exports.adminUpdateUserValidator = exports.reportIdParamValidator = exports.groupIdParamValidator = exports.userIdParamValidator = void 0;
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
//# sourceMappingURL=admin.validator.js.map