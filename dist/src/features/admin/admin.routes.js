"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../shared/middleware/auth.middleware");
const validators_1 = require("../../shared/utils/validators");
const admin_controller_1 = require("./admin.controller");
const admin_validator_1 = require("./admin.validator");
const router = (0, express_1.Router)();
// All admin routes require authentication + platform.admin permission
router.use(auth_middleware_1.authenticate, (0, auth_middleware_1.authorize)('platform.admin'));
// ── Stats (home page) ─────────────────────────────────────────────────────────
router.get('/stats', admin_controller_1.adminController.getStats);
// ── Users ────────────────────────────────────────────────────────────────────
router.get('/users', (0, validators_1.validateRequest)(admin_validator_1.adminListUsersValidator), admin_controller_1.adminController.listUsers);
router.patch('/users/:id', (0, validators_1.validateRequest)([...admin_validator_1.userIdParamValidator, ...admin_validator_1.adminUpdateUserValidator]), admin_controller_1.adminController.updateUserStatus);
router.patch('/users/:id/role', (0, auth_middleware_1.authorize)('platform.manage_roles'), (0, validators_1.validateRequest)([...admin_validator_1.userIdParamValidator, ...admin_validator_1.adminChangeRoleValidator]), admin_controller_1.adminController.changeUserRole);
router.get('/users/:id/verification', (0, validators_1.validateRequest)(admin_validator_1.userIdParamValidator), admin_controller_1.adminController.getUserVerification);
router.patch('/users/:id/verification', (0, validators_1.validateRequest)([...admin_validator_1.userIdParamValidator, ...admin_validator_1.adminVerifyIdValidator]), admin_controller_1.adminController.reviewIdVerification);
// ── Groups ────────────────────────────────────────────────────────────────────
router.get('/groups', (0, validators_1.validateRequest)(admin_validator_1.adminListGroupsValidator), admin_controller_1.adminController.listGroups);
router.patch('/groups/:id', (0, validators_1.validateRequest)([...admin_validator_1.groupIdParamValidator, ...admin_validator_1.adminUpdateGroupValidator]), admin_controller_1.adminController.updateGroup);
// ── Reports ───────────────────────────────────────────────────────────────────
router.get('/reports', (0, validators_1.validateRequest)(admin_validator_1.adminListReportsValidator), admin_controller_1.adminController.listReports);
router.patch('/reports/:id', (0, validators_1.validateRequest)([...admin_validator_1.reportIdParamValidator, ...admin_validator_1.adminResolveReportValidator]), admin_controller_1.adminController.resolveReport);
// ── Audit logs ────────────────────────────────────────────────────────────────
router.get('/audit-logs', (0, validators_1.validateRequest)(admin_validator_1.adminAuditLogsValidator), admin_controller_1.adminController.listAuditLogs);
exports.default = router;
//# sourceMappingURL=admin.routes.js.map