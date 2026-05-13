"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const express_validator_1 = require("express-validator");
const auth_middleware_1 = require("../../shared/middleware/auth.middleware");
const upload_middleware_1 = require("../../shared/middleware/upload.middleware");
const validators_1 = require("../../shared/utils/validators");
const message_controller_1 = require("./message.controller");
const message_validator_1 = require("./message.validator");
const router = (0, express_1.Router)();
const reactionValidator = [
    (0, express_validator_1.body)('emoji')
        .exists().withMessage('emoji is required')
        .isString().isLength({ min: 1, max: 10 }).withMessage('Invalid emoji'),
];
// ── Group-scoped routes (/groups/:id/...) ─────────────────────────────────────
// Pinned messages before /:messageId routes to avoid param collision
router.get('/groups/:id/messages/pinned', auth_middleware_1.authenticate, message_controller_1.messageController.listPinned);
router.get('/groups/:id/messages', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(message_validator_1.listMessagesValidator), message_controller_1.messageController.listMessages);
router.post('/groups/:id/messages', auth_middleware_1.authenticateVerified, (0, upload_middleware_1.uploadImage)('media'), (0, validators_1.validateRequest)(message_validator_1.sendMessageValidator), message_controller_1.messageController.sendMessage);
// Toggle group chat lock — admin only (enforced inside service)
router.patch('/groups/:id/chat', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(message_validator_1.toggleChatLockValidator), message_controller_1.messageController.toggleChatLock);
// ── Message-scoped routes (/messages/:id/...) ─────────────────────────────────
router.delete('/messages/:id', auth_middleware_1.authenticate, message_controller_1.messageController.deleteMessage);
router.patch('/messages/:id/pin', auth_middleware_1.authenticate, message_controller_1.messageController.togglePin);
router.post('/messages/:id/react', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(reactionValidator), message_controller_1.messageController.addReaction);
router.delete('/messages/:id/react', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(reactionValidator), message_controller_1.messageController.removeReaction);
exports.default = router;
//# sourceMappingURL=message.routes.js.map