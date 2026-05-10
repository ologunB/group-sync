"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupController = void 0;
const http_status_codes_1 = require("http-status-codes");
const group_service_1 = require("./group.service");
const response_helper_1 = require("../../shared/utils/response.helper");
const groupService = new group_service_1.GroupService();
function parsePagination(req) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    return { page, limit };
}
class GroupController {
    // ─── POST /groups ──────────────────────────────────────────────────────────
    createGroup = async (req, res, next) => {
        try {
            const group = await groupService.createGroup(req.body, req.user);
            response_helper_1.ResponseHelper.success(res, group, 'Group created successfully.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── GET /groups ───────────────────────────────────────────────────────────
    listGroups = async (req, res, next) => {
        try {
            const query = {
                q: req.query.q,
                category: req.query.category,
                subcategory: req.query.subcategory,
                city: req.query.city,
                state: req.query.state,
                country: req.query.country,
                lat: req.query.lat ? parseFloat(req.query.lat) : undefined,
                lng: req.query.lng ? parseFloat(req.query.lng) : undefined,
                radius_km: req.query.radius_km ? parseFloat(req.query.radius_km) : undefined,
                membership_type: req.query.membership_type,
                min_members: req.query.min_members ? parseInt(req.query.min_members, 10) : undefined,
                max_members: req.query.max_members ? parseInt(req.query.max_members, 10) : undefined,
                is_verified: req.query.is_verified !== undefined ? req.query.is_verified === 'true' : undefined,
                sort: req.query.sort,
                page: parseInt(req.query.page, 10) || 1,
                limit: parseInt(req.query.limit, 10) || 20,
            };
            const result = await groupService.listGroups(query, req.user?.userId);
            response_helper_1.ResponseHelper.success(res, result.data, 'Success', http_status_codes_1.StatusCodes.OK, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── GET /groups/:slug ─────────────────────────────────────────────────────
    getGroupBySlug = async (req, res, next) => {
        try {
            const result = await groupService.getGroupBySlug(req.params.slug, req.user?.userId);
            response_helper_1.ResponseHelper.success(res, result);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── PATCH /groups/:id ─────────────────────────────────────────────────────
    updateGroup = async (req, res, next) => {
        try {
            const group = await groupService.updateGroup(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, group, 'Group updated successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── DELETE /groups/:id ────────────────────────────────────────────────────
    deleteGroup = async (req, res, next) => {
        try {
            await groupService.deleteGroup(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Group deleted successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── GET /groups/:id/members ───────────────────────────────────────────────
    getGroupMembers = async (req, res, next) => {
        try {
            const { page, limit } = parsePagination(req);
            const role = req.query.role;
            const search = req.query.search;
            const result = await groupService.getGroupMembers(req.params.id, page, limit, role, search);
            response_helper_1.ResponseHelper.success(res, result.data, 'Success', http_status_codes_1.StatusCodes.OK, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── GET /groups/:id/stats ─────────────────────────────────────────────────
    getGroupStats = async (req, res, next) => {
        try {
            const stats = await groupService.getGroupStats(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, stats);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /groups/:id/cover ────────────────────────────────────────────────
    uploadCover = async (req, res, next) => {
        try {
            if (!req.file) {
                response_helper_1.ResponseHelper.error(res, 'No image file provided', http_status_codes_1.StatusCodes.BAD_REQUEST);
                return;
            }
            const result = await groupService.uploadCover(req.params.id, req.file.buffer, req.file.mimetype);
            response_helper_1.ResponseHelper.success(res, result, 'Cover image updated successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /groups/:id/logo ─────────────────────────────────────────────────
    uploadLogo = async (req, res, next) => {
        try {
            if (!req.file) {
                response_helper_1.ResponseHelper.error(res, 'No image file provided', http_status_codes_1.StatusCodes.BAD_REQUEST);
                return;
            }
            const result = await groupService.uploadLogo(req.params.id, req.file.buffer, req.file.mimetype);
            response_helper_1.ResponseHelper.success(res, result, 'Logo updated successfully.');
        }
        catch (error) {
            next(error);
        }
    };
}
exports.GroupController = GroupController;
//# sourceMappingURL=group.controller.js.map