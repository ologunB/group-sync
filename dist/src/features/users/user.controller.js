"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserController = void 0;
const http_status_codes_1 = require("http-status-codes");
const user_service_1 = require("./user.service");
const response_helper_1 = require("../../shared/utils/response.helper");
const userService = new user_service_1.UserService();
// ─── Pagination helper ────────────────────────────────────────────────────────
function parsePagination(req) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    return { page, limit };
}
// ─── AuthController ───────────────────────────────────────────────────────────
class UserController {
    // ─── GET /users/me ─────────────────────────────────────────────────────────
    getMe = async (req, res, next) => {
        try {
            const user = await userService.getMe(req.user);
            response_helper_1.ResponseHelper.success(res, user);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── PATCH /users/me ───────────────────────────────────────────────────────
    updateMe = async (req, res, next) => {
        try {
            const user = await userService.updateMe(req.body, req.user);
            response_helper_1.ResponseHelper.success(res, user, 'Profile updated successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── DELETE /users/me ──────────────────────────────────────────────────────
    deleteMe = async (req, res, next) => {
        try {
            await userService.deleteMe(req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Account deleted successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── GET /users/me/groups ──────────────────────────────────────────────────
    getMyGroups = async (req, res, next) => {
        try {
            const { page, limit } = parsePagination(req);
            const result = await userService.getMyGroups(req.user, page, limit);
            response_helper_1.ResponseHelper.success(res, result.data, 'Success', http_status_codes_1.StatusCodes.OK, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── GET /users/me/applications ────────────────────────────────────────────
    getMyApplications = async (req, res, next) => {
        try {
            const { page, limit } = parsePagination(req);
            const status = req.query.status;
            const result = await userService.getMyApplications(req.user, page, limit, status);
            response_helper_1.ResponseHelper.success(res, result.data, 'Success', http_status_codes_1.StatusCodes.OK, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /users/me/interests ──────────────────────────────────────────────
    updateInterests = async (req, res, next) => {
        try {
            const result = await userService.updateInterests(req.body, req.user);
            response_helper_1.ResponseHelper.success(res, result, 'Interests updated successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── GET /users/:id ────────────────────────────────────────────────────────
    getUserById = async (req, res, next) => {
        try {
            const user = await userService.getUserById(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, user);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /users/:id/block ─────────────────────────────────────────────────
    blockUser = async (req, res, next) => {
        try {
            await userService.blockUser(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'User blocked successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── DELETE /users/:id/block ───────────────────────────────────────────────
    unblockUser = async (req, res, next) => {
        try {
            await userService.unblockUser(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'User unblocked successfully.');
        }
        catch (error) {
            next(error);
        }
    };
}
exports.UserController = UserController;
//# sourceMappingURL=user.controller.js.map