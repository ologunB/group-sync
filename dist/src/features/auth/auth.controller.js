"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthController = void 0;
const http_status_codes_1 = require("http-status-codes");
const auth_service_1 = require("./auth.service");
const response_constants_1 = require("../../shared/utils/response.constants");
const response_helper_1 = require("../../shared/utils/response.helper");
const authService = new auth_service_1.AuthService();
class AuthController {
    // ─── POST /auth/register ───────────────────────────────────────────────────
    register = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            const result = await authService.register(req.body, ipAddress);
            response_helper_1.ResponseHelper.success(res, result, response_constants_1.Messages.REGISTERED, http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/login ──────────────────────────────────────────────────────
    login = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            const result = await authService.login(req.body, ipAddress);
            response_helper_1.ResponseHelper.success(res, result, response_constants_1.Messages.LOGGED_IN);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/social ─────────────────────────────────────────────────────
    socialLogin = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            const result = await authService.socialLogin(req.body, ipAddress);
            response_helper_1.ResponseHelper.success(res, result, response_constants_1.Messages.LOGGED_IN);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/logout ─────────────────────────────────────────────────────
    logout = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            await authService.logout(req.body, req.user, ipAddress);
            response_helper_1.ResponseHelper.success(res, null, response_constants_1.Messages.LOGGED_OUT);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/refresh ────────────────────────────────────────────────────
    refresh = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            const tokens = await authService.refresh(req.body, ipAddress);
            response_helper_1.ResponseHelper.success(res, { tokens }, response_constants_1.Messages.TOKEN_REFRESHED);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/forgot-password ────────────────────────────────────────────
    forgotPassword = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            await authService.forgotPassword(req.body, ipAddress);
            response_helper_1.ResponseHelper.success(res, null, response_constants_1.Messages.PASSWORD_RESET_EMAIL_SENT);
        }
        catch (error) {
            next(error);
        }
    };
    verifyForgotOtp = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            await authService.verifyForgotOtp(req.body, ipAddress);
            response_helper_1.ResponseHelper.success(res, null, 'OTP is valid.');
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/reset-password ─────────────────────────────────────────────
    resetPassword = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            await authService.resetPassword(req.body, ipAddress);
            response_helper_1.ResponseHelper.success(res, null, response_constants_1.Messages.PASSWORD_RESET_SUCCESS);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/change-password ────────────────────────────────────────────
    changePassword = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            await authService.changePassword(req.body, req.user, ipAddress);
            response_helper_1.ResponseHelper.success(res, null, response_constants_1.Messages.PASSWORD_CHANGED);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/verify-email ───────────────────────────────────────────────
    verifyEmail = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            await authService.verifyEmail(req.body, ipAddress);
            response_helper_1.ResponseHelper.success(res, null, response_constants_1.Messages.EMAIL_VERIFIED);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/resend-verification ───────────────────────────────────────
    resendVerification = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            await authService.resendVerification(req.body, ipAddress);
            response_helper_1.ResponseHelper.success(res, null, response_constants_1.Messages.VERIFICATION_EMAIL_SENT);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/verify-id ──────────────────────────────────────────────────
    submitIdVerification = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            const result = await authService.submitIdVerification(req.body, req.user, ipAddress);
            response_helper_1.ResponseHelper.success(res, result, response_constants_1.Messages.ID_VERIFICATION_SUBMITTED, http_status_codes_1.StatusCodes.ACCEPTED);
        }
        catch (error) {
            next(error);
        }
    };
    // ─── POST /auth/kyc-webhook ────────────────────────────────────────────────
    handleKycWebhook = async (req, res, next) => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown');
            const signature = req.headers['x-webhook-signature'] ?? '';
            // Pass the raw body as a string for HMAC verification
            const rawBody = JSON.stringify(req.body);
            await authService.handleKycWebhook(req.body, rawBody, signature, ipAddress);
            response_helper_1.ResponseHelper.success(res, null, 'Webhook received');
        }
        catch (error) {
            next(error);
        }
    };
}
exports.AuthController = AuthController;
//# sourceMappingURL=auth.controller.js.map