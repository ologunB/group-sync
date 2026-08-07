"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminController = exports.AdminController = void 0;
const response_helper_1 = require("../../shared/utils/response.helper");
const admin_service_1 = require("./admin.service");
class AdminController {
    // ── Users ─────────────────────────────────────────────────────────────────
    listUsers = async (req, res, next) => {
        try {
            const q = {
                page: req.query.page ? parseInt(req.query.page, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
                status: req.query.status,
                search: req.query.search,
            };
            const result = await admin_service_1.adminService.listUsers(q);
            response_helper_1.ResponseHelper.success(res, result.data, 'Users retrieved.', 200, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    updateUserStatus = async (req, res, next) => {
        try {
            const user = await admin_service_1.adminService.updateUserStatus(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, user, 'User status updated.');
        }
        catch (error) {
            next(error);
        }
    };
    getUserVerification = async (req, res, next) => {
        try {
            const data = await admin_service_1.adminService.getUserVerification(req.params.id);
            response_helper_1.ResponseHelper.success(res, data, 'User verification data retrieved.');
        }
        catch (error) {
            next(error);
        }
    };
    reviewIdVerification = async (req, res, next) => {
        try {
            const user = await admin_service_1.adminService.reviewIdVerification(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, user, 'ID verification decision recorded.');
        }
        catch (error) {
            next(error);
        }
    };
    // ── Groups ────────────────────────────────────────────────────────────────
    listGroups = async (req, res, next) => {
        try {
            const q = {
                page: req.query.page ? parseInt(req.query.page, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
                status: req.query.status,
                search: req.query.search,
                review_status: req.query.review_status,
            };
            const result = await admin_service_1.adminService.listGroups(q);
            response_helper_1.ResponseHelper.success(res, result.data, 'Groups retrieved.', 200, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    // GET /admin/groups/pending — the review queue.
    listPendingGroups = async (req, res, next) => {
        try {
            const q = {
                page: req.query.page ? parseInt(req.query.page, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
                search: req.query.search,
                review_status: req.query.review_status,
            };
            const result = await admin_service_1.adminService.listPendingGroups(q);
            response_helper_1.ResponseHelper.success(res, result.data, 'Pending groups retrieved.', 200, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    // PATCH /admin/groups/:id/review
    reviewGroup = async (req, res, next) => {
        try {
            const group = await admin_service_1.adminService.reviewGroup(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, group, 'Group review recorded.');
        }
        catch (error) {
            next(error);
        }
    };
    updateGroup = async (req, res, next) => {
        try {
            const group = await admin_service_1.adminService.updateGroup(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, group, 'Group updated.');
        }
        catch (error) {
            next(error);
        }
    };
    // ── Reports ───────────────────────────────────────────────────────────────
    listReports = async (req, res, next) => {
        try {
            const q = {
                page: req.query.page ? parseInt(req.query.page, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
                status: req.query.status,
            };
            const result = await admin_service_1.adminService.listReports(q);
            response_helper_1.ResponseHelper.success(res, result.data, 'Reports retrieved.', 200, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    resolveReport = async (req, res, next) => {
        try {
            const report = await admin_service_1.adminService.resolveReport(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, report, 'Report resolved.');
        }
        catch (error) {
            next(error);
        }
    };
    // ── Stats ─────────────────────────────────────────────────────────────────
    getStats = async (_req, res, next) => {
        try {
            const stats = await admin_service_1.adminService.getStats();
            response_helper_1.ResponseHelper.success(res, stats, 'Platform stats retrieved.');
        }
        catch (error) {
            next(error);
        }
    };
    changeUserRole = async (req, res, next) => {
        try {
            const user = await admin_service_1.adminService.changeUserRole(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, user, 'User role updated.');
        }
        catch (error) {
            next(error);
        }
    };
    // ── Audit logs ────────────────────────────────────────────────────────────
    listAuditLogs = async (req, res, next) => {
        try {
            const q = {
                page: req.query.page ? parseInt(req.query.page, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
                user_id: req.query.user_id,
                action: req.query.action,
                entity_type: req.query.entity_type,
                date_from: req.query.date_from,
                date_to: req.query.date_to,
            };
            const result = await admin_service_1.adminService.listAuditLogs(q);
            response_helper_1.ResponseHelper.success(res, result.data, 'Audit logs retrieved.', 200, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── Taxonomy: categories ─────────────────────────────────────────────────
    listCategories = async (req, res, next) => {
        try {
            const data = await admin_service_1.adminService.listCategories({ include_inactive: req.query.include_inactive === 'true' });
            response_helper_1.ResponseHelper.success(res, data);
        }
        catch (error) {
            next(error);
        }
    };
    createCategory = async (req, res, next) => {
        try {
            const data = await admin_service_1.adminService.createCategory(req.body, req.user);
            response_helper_1.ResponseHelper.success(res, data, 'Category created.', 201);
        }
        catch (error) {
            next(error);
        }
    };
    updateCategory = async (req, res, next) => {
        try {
            const data = await admin_service_1.adminService.updateCategory(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, data, 'Category updated.');
        }
        catch (error) {
            next(error);
        }
    };
    deleteCategory = async (req, res, next) => {
        try {
            const data = await admin_service_1.adminService.deleteCategory(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, data, 'Category removed.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── Taxonomy: interests ──────────────────────────────────────────────────
    listInterests = async (req, res, next) => {
        try {
            const data = await admin_service_1.adminService.listInterests({ include_inactive: req.query.include_inactive === 'true' });
            response_helper_1.ResponseHelper.success(res, data);
        }
        catch (error) {
            next(error);
        }
    };
    createInterest = async (req, res, next) => {
        try {
            const data = await admin_service_1.adminService.createInterest(req.body, req.user);
            response_helper_1.ResponseHelper.success(res, data, 'Interest created.', 201);
        }
        catch (error) {
            next(error);
        }
    };
    updateInterest = async (req, res, next) => {
        try {
            const data = await admin_service_1.adminService.updateInterest(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, data, 'Interest updated.');
        }
        catch (error) {
            next(error);
        }
    };
    deleteInterest = async (req, res, next) => {
        try {
            const data = await admin_service_1.adminService.deleteInterest(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, data, 'Interest removed.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── Event moderation ─────────────────────────────────────────────────────
    listEvents = async (req, res, next) => {
        try {
            const result = await admin_service_1.adminService.listEvents({
                page: req.query.page ? parseInt(req.query.page, 10) : undefined,
                limit: req.query.limit ? parseInt(req.query.limit, 10) : undefined,
                status: req.query.status,
                search: req.query.search,
                when: req.query.when,
            });
            response_helper_1.ResponseHelper.success(res, result.data, 'Events retrieved.', 200, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    cancelEvent = async (req, res, next) => {
        try {
            const data = await admin_service_1.adminService.cancelEvent(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, data, 'Event cancelled.');
        }
        catch (error) {
            next(error);
        }
    };
}
exports.AdminController = AdminController;
exports.adminController = new AdminController();
//# sourceMappingURL=admin.controller.js.map