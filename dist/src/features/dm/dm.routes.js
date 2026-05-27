"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../shared/middleware/auth.middleware");
const upload_middleware_1 = require("../../shared/middleware/upload.middleware");
const validators_1 = require("../../shared/utils/validators");
const dm_controller_1 = require("./dm.controller");
const dm_validator_1 = require("./dm.validator");
const router = (0, express_1.Router)();
// Unified conversation inbox (groups + DMs)
router.get('/conversations', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(dm_validator_1.listConversationsValidator), dm_controller_1.dmController.listConversations);
// DM thread with a specific user
router.get('/dm/:userId', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(dm_validator_1.listThreadValidator), dm_controller_1.dmController.getThread);
// Send DM
router.post('/dm/:userId', auth_middleware_1.authenticateVerified, (0, upload_middleware_1.uploadMedia)('media'), (0, validators_1.validateRequest)(dm_validator_1.sendDmValidator), dm_controller_1.dmController.sendDm);
// Mark thread as read
router.patch('/dm/:userId/read', auth_middleware_1.authenticate, dm_controller_1.dmController.markRead);
// Delete a single DM (soft, per-side)
router.delete('/dm/:dmId', auth_middleware_1.authenticate, dm_controller_1.dmController.deleteDm);
// Reactions on a DM
router.post('/dm/:dmId/react', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(dm_validator_1.dmReactionValidator), dm_controller_1.dmController.addReaction);
router.delete('/dm/:dmId/react', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(dm_validator_1.dmReactionValidator), dm_controller_1.dmController.removeReaction);
exports.default = router;
//# sourceMappingURL=dm.routes.js.map