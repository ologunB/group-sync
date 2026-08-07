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
    adminReviewGroupValidator,
    taxonomyIdParamValidator,
    adminListTaxonomyValidator,
    adminCreateCategoryValidator,
    adminUpdateCategoryValidator,
    adminCreateInterestValidator,
    adminUpdateInterestValidator,
    eventIdParamValidator,
    adminListEventsValidator,
    adminCancelEventValidator,
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
// '/groups/pending' must precede '/groups/:id' — otherwise ':id' swallows 'pending'.
router.get('/groups/pending', validateRequest(adminListGroupsValidator), adminController.listPendingGroups);
router.get('/groups', validateRequest(adminListGroupsValidator), adminController.listGroups);
router.patch('/groups/:id/review', validateRequest([...groupIdParamValidator, ...adminReviewGroupValidator]), adminController.reviewGroup);
router.patch('/groups/:id', validateRequest([...groupIdParamValidator, ...adminUpdateGroupValidator]), adminController.updateGroup);

// ── Reports ───────────────────────────────────────────────────────────────────
router.get('/reports', validateRequest(adminListReportsValidator), adminController.listReports);
router.patch('/reports/:id', validateRequest([...reportIdParamValidator, ...adminResolveReportValidator]), adminController.resolveReport);

// ── Audit logs ────────────────────────────────────────────────────────────────
router.get('/audit-logs', validateRequest(adminAuditLogsValidator), adminController.listAuditLogs);

// ── Taxonomy: group categories ───────────────────────────────────────────────
// `value` is fixed at creation — it is the string stored on groups.category, so
// renaming it would orphan every group filed under it. Edit `label` instead.
router.get('/categories', validateRequest(adminListTaxonomyValidator), adminController.listCategories);
router.post('/categories', validateRequest(adminCreateCategoryValidator), adminController.createCategory);
router.patch('/categories/:id', validateRequest([...taxonomyIdParamValidator, ...adminUpdateCategoryValidator]), adminController.updateCategory);
router.delete('/categories/:id', validateRequest(taxonomyIdParamValidator), adminController.deleteCategory);

// ── Taxonomy: user interests ─────────────────────────────────────────────────
router.get('/interests', validateRequest(adminListTaxonomyValidator), adminController.listInterests);
router.post('/interests', validateRequest(adminCreateInterestValidator), adminController.createInterest);
router.patch('/interests/:id', validateRequest([...taxonomyIdParamValidator, ...adminUpdateInterestValidator]), adminController.updateInterest);
router.delete('/interests/:id', validateRequest(taxonomyIdParamValidator), adminController.deleteInterest);

// ── Event moderation ─────────────────────────────────────────────────────────
router.get('/events', validateRequest(adminListEventsValidator), adminController.listEvents);
router.patch('/events/:id/cancel', validateRequest([...eventIdParamValidator, ...adminCancelEventValidator]), adminController.cancelEvent);

export default router;
