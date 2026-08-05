import { Router } from 'express';
import { AuthController } from './auth.controller';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { validateRequest } from '../../shared/utils/validators';
import {
    registerValidator,
    loginValidator,
    socialLoginValidator,
    logoutValidator,
    refreshTokenValidator,
    forgotPasswordValidator,
    resetPasswordValidator,
    changePasswordValidator,
    verifyEmailValidator,
    resendVerificationValidator,
    submitIdVerificationValidator, verifyForgotOtpValidator,
    sendPhoneOtpValidator,
    verifyPhoneOtpValidator,
} from './auth.validator';

const router = Router();
const controller = new AuthController();

// ─── Public routes ─────────────────────────────────────────────────────────────

router.post('/register',               validateRequest(registerValidator),             controller.register);
router.post('/login',                  validateRequest(loginValidator),                controller.login);
router.post('/social',                 validateRequest(socialLoginValidator),           controller.socialLogin);
router.post('/refresh',                validateRequest(refreshTokenValidator),          controller.refresh);
router.post('/forgot-password',        validateRequest(forgotPasswordValidator),        controller.forgotPassword);
router.post('/verify-forgot-otp',      validateRequest(verifyForgotOtpValidator),       controller.verifyForgotOtp);
router.post('/reset-password',         validateRequest(resetPasswordValidator),         controller.resetPassword);
router.post('/verify-email',           validateRequest(verifyEmailValidator),           controller.verifyEmail);
router.post('/resend-verification',    validateRequest(resendVerificationValidator),    controller.resendVerification);

// ─── KYC webhook — internal, signature-verified inside service ─────────────────

router.post('/kyc-webhook',            controller.handleKycWebhook);

// ─── Authenticated routes ──────────────────────────────────────────────────────

router.post('/logout',                 authenticate, validateRequest(logoutValidator),                controller.logout);
router.post('/change-password',        authenticate, validateRequest(changePasswordValidator),         controller.changePassword);

// Phone verification (tier 1). Plain `authenticate` — an unverified account is exactly
// who needs to reach these.
router.post('/phone/send-otp',         authenticate, validateRequest(sendPhoneOtpValidator),           controller.sendPhoneOtp);
router.post('/phone/verify',           authenticate, validateRequest(verifyPhoneOtpValidator),         controller.verifyPhoneOtp);

// verify-id uses authenticate (not authenticateVerified) — unverified users must submit this
router.post('/verify-id',              authenticate, validateRequest(submitIdVerificationValidator),   controller.submitIdVerification);

export default router;
