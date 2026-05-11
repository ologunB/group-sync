"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toggleChatLockValidator = exports.listMessagesValidator = exports.sendMessageValidator = void 0;
const express_validator_1 = require("express-validator");
exports.sendMessageValidator = [
    (0, express_validator_1.body)('content')
        .optional({ nullable: true })
        .isString().withMessage('Content must be a string')
        .isLength({ max: 4000 }).withMessage('Content must be at most 4000 characters'),
    (0, express_validator_1.body)('message_type')
        .optional()
        .isIn(['text', 'image', 'file', 'poll', 'voice_note'])
        .withMessage('Invalid message type'),
    (0, express_validator_1.body)('media_url')
        .optional({ nullable: true })
        .isURL().withMessage('media_url must be a valid URL'),
    (0, express_validator_1.body)('reply_to_id')
        .optional({ nullable: true })
        .isUUID().withMessage('reply_to_id must be a UUID'),
];
exports.listMessagesValidator = [
    (0, express_validator_1.query)('cursor')
        .optional()
        .isUUID().withMessage('cursor must be a UUID'),
    (0, express_validator_1.query)('limit')
        .optional()
        .isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100'),
    (0, express_validator_1.query)('direction')
        .optional()
        .isIn(['before', 'after']).withMessage("direction must be 'before' or 'after'"),
];
exports.toggleChatLockValidator = [
    (0, express_validator_1.body)('locked')
        .exists().withMessage('locked is required')
        .isBoolean().withMessage('locked must be a boolean'),
];
//# sourceMappingURL=message.validator.js.map