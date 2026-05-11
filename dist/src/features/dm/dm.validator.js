"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listThreadValidator = exports.sendDmValidator = void 0;
const express_validator_1 = require("express-validator");
exports.sendDmValidator = [
    (0, express_validator_1.body)('content')
        .optional({ nullable: true })
        .isString().withMessage('Content must be a string')
        .isLength({ max: 4000 }).withMessage('Content must be at most 4000 characters'),
    (0, express_validator_1.body)('media_url')
        .optional({ nullable: true })
        .isURL().withMessage('media_url must be a valid URL'),
];
exports.listThreadValidator = [
    (0, express_validator_1.query)('cursor')
        .optional()
        .isUUID().withMessage('cursor must be a UUID'),
    (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
];
//# sourceMappingURL=dm.validator.js.map