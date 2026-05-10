"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitReportValidator = void 0;
const express_validator_1 = require("express-validator");
const report_types_1 = require("./report.types");
exports.submitReportValidator = [
    (0, express_validator_1.body)('target_type')
        .exists().withMessage('target_type is required')
        .isIn(report_types_1.REPORT_TARGET_TYPES).withMessage(`target_type must be one of: ${report_types_1.REPORT_TARGET_TYPES.join(', ')}`),
    (0, express_validator_1.body)('target_id')
        .exists().withMessage('target_id is required')
        .isUUID().withMessage('target_id must be a valid UUID'),
    (0, express_validator_1.body)('reason')
        .exists().withMessage('reason is required')
        .isIn(report_types_1.REPORT_REASONS).withMessage(`reason must be one of: ${report_types_1.REPORT_REASONS.join(', ')}`),
    (0, express_validator_1.body)('description')
        .optional()
        .isString().withMessage('description must be a string')
        .isLength({ max: 1000 }).withMessage('description must be 1000 characters or fewer'),
];
//# sourceMappingURL=report.validator.js.map