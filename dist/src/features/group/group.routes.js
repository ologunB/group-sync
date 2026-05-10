"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const group_controller_1 = require("./group.controller");
const auth_middleware_1 = require("../../shared/middleware/auth.middleware");
const validators_1 = require("../../shared/utils/validators");
const upload_middleware_1 = require("../../shared/middleware/upload.middleware");
const group_validator_1 = require("./group.validator");
const router = (0, express_1.Router)();
const controller = new group_controller_1.GroupController();
// ─── POST /groups — verified users only ───────────────────────────────────────
router.post('/', auth_middleware_1.authenticateVerified, (0, validators_1.validateRequest)(group_validator_1.createGroupValidator), controller.createGroup);
// ─── GET /groups — public, optional auth (affects invite-only visibility) ─────
router.get('/', (req, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        (0, auth_middleware_1.authenticate)(req, _res, next);
        return;
    }
    next();
}, (0, validators_1.validateRequest)(group_validator_1.listGroupsValidator), controller.listGroups);
// ─── GET /groups/:slug — public, optional auth ────────────────────────────────
router.get('/:slug', (req, _res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        (0, auth_middleware_1.authenticate)(req, _res, next);
        return;
    }
    next();
}, (0, validators_1.validateRequest)(group_validator_1.groupSlugParamValidator), controller.getGroupBySlug);
// ─── PATCH /groups/:id — admin or super_admin ─────────────────────────────────
router.patch('/:id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(group_validator_1.groupIdParamValidator), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin'), (0, validators_1.validateRequest)(group_validator_1.updateGroupValidator), controller.updateGroup);
// ─── DELETE /groups/:id — super_admin only ────────────────────────────────────
router.delete('/:id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(group_validator_1.groupIdParamValidator), (0, auth_middleware_1.authorizeGroupRole)('super_admin'), controller.deleteGroup);
// ─── GET /groups/:id/members — active members only ───────────────────────────
router.get('/:id/members', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(group_validator_1.memberSearchValidator), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin', 'moderator', 'member'), controller.getGroupMembers);
// ─── GET /groups/:id/stats — admin only ──────────────────────────────────────
router.get('/:id/stats', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(group_validator_1.groupIdParamValidator), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin'), controller.getGroupStats);
// ─── POST /groups/:id/cover — admin or super_admin ───────────────────────────
router.post('/:id/cover', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(group_validator_1.groupIdParamValidator), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin'), (0, upload_middleware_1.uploadImage)('cover'), controller.uploadCover);
// ─── POST /groups/:id/logo — admin or super_admin ────────────────────────────
router.post('/:id/logo', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(group_validator_1.groupIdParamValidator), (0, auth_middleware_1.authorizeGroupRole)('super_admin', 'admin'), (0, upload_middleware_1.uploadImage)('logo'), controller.uploadLogo);
exports.default = router;
//# sourceMappingURL=group.routes.js.map