import { Router } from 'express';
import { authenticate, authorize } from '../../shared/middleware/auth.middleware';
import { validateRequest } from '../../shared/utils/validators';
import { adminController } from './admin.controller';
import {
    userIdParamValidator,
    groupIdParamValidator,
    reportIdParamValidator,
    adminUpdateUserValidator,
    adminVerifyIdValidator,
    adminUpdateGroupValidator,
    adminResolveReportValidator,
    adminListUsersValidator,
    adminListGroupsValidator,
    adminListReportsValidator,
    adminAuditLogsValidator,
    adminChangeRoleValidator,
} from './admin.validator';

const router = Router();

// All admin routes require authentication + platform.admin permission
router.use(authenticate, authorize('platform.admin'));

// ── Stats (home page) ─────────────────────────────────────────────────────────
router.get('/stats', adminController.getStats);

// ── Users ────────────────────────────────────────────────────────────────────
router.get('/users', validateRequest(adminListUsersValidator), adminController.listUsers);
router.patch('/users/:id', validateRequest([...userIdParamValidator, ...adminUpdateUserValidator]), adminController.updateUserStatus);
router.patch('/users/:id/role',
    authorize('platform.manage_roles'),
    validateRequest([...userIdParamValidator, ...adminChangeRoleValidator]),
    adminController.changeUserRole,
);
router.get('/users/:id/verification', validateRequest(userIdParamValidator), adminController.getUserVerification);
router.patch('/users/:id/verification', validateRequest([...userIdParamValidator, ...adminVerifyIdValidator]), adminController.reviewIdVerification);

// ── Groups ────────────────────────────────────────────────────────────────────
router.get('/groups', validateRequest(adminListGroupsValidator), adminController.listGroups);
router.patch('/groups/:id', validateRequest([...groupIdParamValidator, ...adminUpdateGroupValidator]), adminController.updateGroup);

// ── Reports ───────────────────────────────────────────────────────────────────
router.get('/reports', validateRequest(adminListReportsValidator), adminController.listReports);
router.patch('/reports/:id', validateRequest([...reportIdParamValidator, ...adminResolveReportValidator]), adminController.resolveReport);

// ── Audit logs ────────────────────────────────────────────────────────────────
router.get('/audit-logs', validateRequest(adminAuditLogsValidator), adminController.listAuditLogs);

export default router;
