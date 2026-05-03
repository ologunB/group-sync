"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_controller_1 = require("./auth.controller");
const auth_middleware_1 = require("../../shared/middleware/auth.middleware");
const validators_1 = require("../../shared/utils/validators");
const auth_validator_1 = require("./auth.validator");
const router = (0, express_1.Router)();
const controller = new auth_controller_1.AuthController();
// ─── Public routes ─────────────────────────────────────────────────────────────
router.post('/register', (0, validators_1.validateRequest)(auth_validator_1.registerValidator), controller.register);
router.post('/login', (0, validators_1.validateRequest)(auth_validator_1.loginValidator), controller.login);
router.post('/social', (0, validators_1.validateRequest)(auth_validator_1.socialLoginValidator), controller.socialLogin);
router.post('/refresh', (0, validators_1.validateRequest)(auth_validator_1.refreshTokenValidator), controller.refresh);
router.post('/forgot-password', (0, validators_1.validateRequest)(auth_validator_1.forgotPasswordValidator), controller.forgotPassword);
router.post('/verify-forgot-otp', (0, validators_1.validateRequest)(auth_validator_1.verifyForgotOtpValidator), controller.verifyForgotOtp);
router.post('/reset-password', (0, validators_1.validateRequest)(auth_validator_1.resetPasswordValidator), controller.resetPassword);
router.post('/verify-email', (0, validators_1.validateRequest)(auth_validator_1.verifyEmailValidator), controller.verifyEmail);
router.post('/resend-verification', (0, validators_1.validateRequest)(auth_validator_1.resendVerificationValidator), controller.resendVerification);
// ─── KYC webhook — internal, signature-verified inside service ─────────────────
router.post('/kyc-webhook', controller.handleKycWebhook);
// ─── Authenticated routes ──────────────────────────────────────────────────────
router.post('/logout', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(auth_validator_1.logoutValidator), controller.logout);
router.post('/change-password', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(auth_validator_1.changePasswordValidator), controller.changePassword);
// verify-id uses authenticate (not authenticateVerified) — unverified users must submit this
router.post('/verify-id', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(auth_validator_1.submitIdVerificationValidator), controller.submitIdVerification);
exports.default = router;
//# sourceMappingURL=auth.routes.js.map