"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MembershipController = void 0;
const http_status_codes_1 = require("http-status-codes");
const membership_service_1 = require("./membership.service");
const response_helper_1 = require("../../shared/utils/response.helper");
const membershipService = new membership_service_1.MembershipService();
function parsePagination(req) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    return { page, limit };
}
class MembershipController {
    // ─── POST /groups/:id/join ─────────────────────────────────────────────────
    joinGroup = async (req, res, next) => {
        try {
            await membershipService.joinGroup(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'You have joined the group successfully.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /groups/:id/apply ────────────────────────────────────────────────
    applyToGroup = async (req, res, next) => {
        try {
            const result = await membershipService.applyToGroup(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, result, 'Application submitted successfully.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── DELETE /groups/:id/leave ──────────────────────────────────────────────
    leaveGroup = async (req, res, next) => {
        try {
            await membershipService.leaveGroup(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'You have left the group.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── GET /groups/:id/applications ─────────────────────────────────────────
    getApplications = async (req, res, next) => {
        try {
            const { page, limit } = parsePagination(req);
            const status = req.query.status;
            const result = await membershipService.getApplications(req.params.id, page, limit, status);
            response_helper_1.ResponseHelper.success(res, result.data, 'Success', http_status_codes_1.StatusCodes.OK, result.pagination);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── PATCH /applications/:id ───────────────────────────────────────────────
    reviewApplication = async (req, res, next) => {
        try {
            await membershipService.reviewApplication(req.params.id, req.body, req.user);
            const msg = req.body.action === 'approve'
                ? 'Application approved. Member added to the group.'
                : 'Application rejected.';
            response_helper_1.ResponseHelper.success(res, null, msg);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── DELETE /applications/:id ──────────────────────────────────────────────
    withdrawApplication = async (req, res, next) => {
        try {
            await membershipService.withdrawApplication(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Application withdrawn successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── GET /groups/:id/form ──────────────────────────────────────────────────
    getGroupForm = async (req, res, next) => {
        try {
            const form = await membershipService.getGroupForm(req.params.id);
            response_helper_1.ResponseHelper.success(res, form);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── PUT /groups/:id/form ──────────────────────────────────────────────────
    upsertGroupForm = async (req, res, next) => {
        try {
            const form = await membershipService.upsertGroupForm(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, form, 'Application form saved successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── PATCH /groups/:id/members/:userId ────────────────────────────────────
    updateMember = async (req, res, next) => {
        try {
            await membershipService.updateMember(req.params.id, req.params.userId, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Member updated successfully.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── DELETE /groups/:id/members/:userId ───────────────────────────────────
    removeMember = async (req, res, next) => {
        try {
            await membershipService.removeMember(req.params.id, req.params.userId, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Member removed from the group.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /groups/:id/invite ───────────────────────────────────────────────
    generateInviteLink = async (req, res, next) => {
        try {
            const result = await membershipService.generateInviteLink(req.params.id, req.body, req.user);
            response_helper_1.ResponseHelper.success(res, result, 'Invite link generated.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── GET /groups/:id/invites ───────────────────────────────────────────────
    getInviteLinks = async (req, res, next) => {
        try {
            const links = await membershipService.getInviteLinks(req.params.id);
            response_helper_1.ResponseHelper.success(res, links);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── DELETE /invites/:id ───────────────────────────────────────────────────
    revokeInviteLink = async (req, res, next) => {
        try {
            await membershipService.revokeInviteLink(req.params.id, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'Invite link revoked.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /invites/:token/accept ───────────────────────────────────────────
    acceptInvite = async (req, res, next) => {
        try {
            await membershipService.acceptInvite(req.params.token, req.user);
            response_helper_1.ResponseHelper.success(res, null, 'You have joined the group via invite link.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
}
exports.MembershipController = MembershipController;
//# sourceMappingURL=membership.controller.js.map