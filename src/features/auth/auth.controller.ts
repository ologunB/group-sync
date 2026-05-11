import { Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './auth.types';
import {Messages} from "../../shared/utils/response.constants";
import {ResponseHelper} from "../../shared/utils/response.helper";

const authService = new AuthService();

export class AuthController {
    // ─── POST /auth/register ───────────────────────────────────────────────────

    register = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            const result = await authService.register(req.body, ipAddress);
            ResponseHelper.success(res, result, Messages.REGISTERED, StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/login ──────────────────────────────────────────────────────

    login = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            const result = await authService.login(req.body, ipAddress);
            ResponseHelper.success(res, result, Messages.LOGGED_IN);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/social ─────────────────────────────────────────────────────

    socialLogin = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            const result = await authService.socialLogin(req.body, ipAddress);
            ResponseHelper.success(res, result, Messages.LOGGED_IN);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/logout ─────────────────────────────────────────────────────

    logout = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            await authService.logout(req.body, req.user!, ipAddress);
            ResponseHelper.success(res, null, Messages.LOGGED_OUT);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/refresh ────────────────────────────────────────────────────

    refresh = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            const tokens = await authService.refresh(req.body, ipAddress);
            ResponseHelper.success(res, { tokens }, Messages.TOKEN_REFRESHED);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/forgot-password ────────────────────────────────────────────

    forgotPassword = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            await authService.forgotPassword(req.body, ipAddress);
            ResponseHelper.success(res, null, Messages.PASSWORD_RESET_EMAIL_SENT);
        } catch (error) {
            next(error);
        }
    };

    verifyForgotOtp = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            await authService.verifyForgotOtp(req.body, ipAddress);
            ResponseHelper.success(res, null, 'OTP is valid.');
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/reset-password ─────────────────────────────────────────────

    resetPassword = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            await authService.resetPassword(req.body, ipAddress);
            ResponseHelper.success(res, null, Messages.PASSWORD_RESET_SUCCESS);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/change-password ────────────────────────────────────────────

    changePassword = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            await authService.changePassword(req.body, req.user!, ipAddress);
            ResponseHelper.success(res, null, Messages.PASSWORD_CHANGED);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/verify-email ───────────────────────────────────────────────

    verifyEmail = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            const result = await authService.verifyEmail(req.body, ipAddress);
            ResponseHelper.success(res, result, Messages.EMAIL_VERIFIED);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/resend-verification ───────────────────────────────────────

    resendVerification = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            await authService.resendVerification(req.body, ipAddress);
            ResponseHelper.success(res, null, Messages.VERIFICATION_EMAIL_SENT);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/verify-id ──────────────────────────────────────────────────

    submitIdVerification = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            const result = await authService.submitIdVerification(req.body, req.user!, ipAddress);
            ResponseHelper.success(res, result, Messages.ID_VERIFICATION_SUBMITTED, StatusCodes.ACCEPTED);
        } catch (error) {
            next(error);
        }
    };

    // ─── POST /auth/kyc-webhook ────────────────────────────────────────────────

    handleKycWebhook = async (
        req: AuthenticatedRequest,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            const ipAddress = (req.ip ?? req.socket.remoteAddress ?? 'unknown') as string;
            const signature = (req.headers['x-webhook-signature'] as string) ?? '';
            // Pass the raw body as a string for HMAC verification
            const rawBody = JSON.stringify(req.body);
            await authService.handleKycWebhook(req.body, rawBody, signature, ipAddress);
            ResponseHelper.success(res, null, 'Webhook received');
        } catch (error) {
            next(error);
        }
    };
}
