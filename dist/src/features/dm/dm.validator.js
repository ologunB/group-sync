"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dmReactionValidator = exports.listConversationsValidator = exports.listThreadValidator = exports.sendDmValidator = void 0;
const express_validator_1 = require("express-validator");
exports.sendDmValidator = [
    (0, express_validator_1.body)('content')
        .optional({ nullable: true })
        .isString().withMessage('Content must be a string')
        .isLength({ max: 4000 }).withMessage('Content must be at most 4000 characters'),
    (0, express_validator_1.body)('message_type')
        .optional()
        .isIn(['text', 'image', 'audio'])
        .withMessage('Invalid message type'),
    (0, express_validator_1.body)('media_url')
        .optional({ nullable: true })
        .isURL().withMessage('media_url must be a valid URL'),
    (0, express_validator_1.body)('reply_to_id')
        .optional({ nullable: true })
        .isUUID().withMessage('reply_to_id must be a UUID'),
];
exports.listThreadValidator = [
    (0, express_validator_1.query)('cursor')
        .optional()
        .isUUID().withMessage('cursor must be a UUID'),
    (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
];
exports.listConversationsValidator = [
    (0, express_validator_1.query)('type')
        .optional()
        .isIn(['dm', 'group']).withMessage("type must be either 'dm' or 'group'"),
];
exports.dmReactionValidator = [
    (0, express_validator_1.body)('emoji')
        .exists().withMessage('emoji is required')
        .isString().isLength({ min: 1, max: 10 }).withMessage('Invalid emoji'),
];
//# sourceMappingURL=dm.validator.js.map