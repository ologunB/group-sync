"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const user_controller_1 = require("./user.controller");
const auth_middleware_1 = require("../../shared/middleware/auth.middleware");
const validators_1 = require("../../shared/utils/validators");
const upload_middleware_1 = require("../../shared/middleware/upload.middleware");
const user_validator_1 = require("./user.validator");
const router = (0, express_1.Router)();
const controller = new user_controller_1.UserController();
// ─── /users/me routes — all require authentication ────────────────────────────
router.get('/me', auth_middleware_1.authenticate, controller.getMe);
router.patch('/me', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(user_validator_1.updateProfileValidator), controller.updateMe);
router.post('/me/photo', auth_middleware_1.authenticate, (0, upload_middleware_1.uploadImage)('photo'), controller.uploadPhoto);
router.delete('/me', auth_middleware_1.authenticate, controller.deleteMe);
// Ask before deleting: which groups would be left without an admin.
router.get('/me/deletion-blockers', auth_middleware_1.authenticate, controller.getDeletionBlockers);
router.get('/me/groups', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(user_validator_1.paginationValidator), controller.getMyGroups);
router.get('/me/applications', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(user_validator_1.myApplicationsValidator), controller.getMyApplications);
router.post('/me/interests', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(user_validator_1.updateInterestsValidator), controller.updateInterests);
// ─── /users/:id routes — auth required, public profile ───────────────────────
router.get('/:id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(user_validator_1.userIdParamValidator), controller.getUserById);
router.post('/:id/block', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(user_validator_1.userIdParamValidator), controller.blockUser);
router.delete('/:id/block', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(user_validator_1.userIdParamValidator), controller.unblockUser);
exports.default = router;
//# sourceMappingURL=user.routes.js.map