"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.submitIdVerificationValidator = exports.resendVerificationValidator = exports.verifyEmailValidator = exports.changePasswordValidator = exports.resetPasswordValidator = exports.verifyForgotOtpValidator = exports.forgotPasswordValidator = exports.refreshTokenValidator = exports.logoutValidator = exports.verifyPhoneOtpValidator = exports.sendPhoneOtpValidator = exports.socialLoginValidator = exports.loginValidator = exports.registerValidator = void 0;
const express_validator_1 = require("express-validator");
// ─── Register ─────────────────────────────────────────────────────────────────
exports.registerValidator = [
    (0, express_validator_1.body)('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),
    (0, express_validator_1.body)('password')
        .exists({ checkFalsy: true }).withMessage('Password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    (0, express_validator_1.body)('display_name')
        .exists({ checkFalsy: true }).withMessage('Display name is required')
        .isString().withMessage('Display name must be a string')
        .trim()
        .isLength({ min: 2, max: 100 }).withMessage('Display name must be between 2 and 100 characters'),
    (0, express_validator_1.body)('phone')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Phone must be a string')
        .isMobilePhone('any').withMessage('Must be a valid phone number'),
    // ── Onboarding location + interests ───────────────────────────────────────
    // Captured at signup so the home feed opens on the user's own city.
    (0, express_validator_1.body)('city')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('City must be a string')
        .trim()
        .isLength({ min: 2, max: 100 }).withMessage('City must be between 2 and 100 characters'),
    (0, express_validator_1.body)('state')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('State must be a string')
        .trim()
        .isLength({ min: 2, max: 100 }).withMessage('State must be between 2 and 100 characters'),
    (0, express_validator_1.body)('country')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Country must be a string')
        .trim()
        .isLength({ min: 2, max: 100 }).withMessage('Country must be between 2 and 100 characters'),
    (0, express_validator_1.body)('interests')
        .optional({ nullable: true })
        .isArray({ max: 30 }).withMessage('interests must be an array of up to 30 items'),
    (0, express_validator_1.body)('interests.*')
        .isString().withMessage('Each interest must be a string')
        .trim()
        .isLength({ min: 1, max: 50 }).withMessage('Each interest tag must be between 1 and 50 characters'),
];
// ─── Login ────────────────────────────────────────────────────────────────────
exports.loginValidator = [
    (0, express_validator_1.body)('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),
    (0, express_validator_1.body)('password')
        .exists({ checkFalsy: true }).withMessage('Password is required')
        .isString().withMessage('Password must be a string'),
];
// ─── Social login ─────────────────────────────────────────────────────────────
exports.socialLoginValidator = [
    (0, express_validator_1.body)('provider')
        .exists({ checkFalsy: true }).withMessage('Provider is required')
        .isIn(['google', 'apple']).withMessage('Provider must be "google" or "apple"'),
    (0, express_validator_1.body)('token')
        .exists({ checkFalsy: true }).withMessage('Token is required')
        .isString().withMessage('Token must be a string'),
    // Apple only supplies the user's name to the client on first authorisation, so the
    // client forwards it here. Ignored for Google, whose ID token already carries it.
    (0, express_validator_1.body)('display_name')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Display name must be a string')
        .trim()
        .isLength({ min: 2, max: 100 }).withMessage('Display name must be between 2 and 100 characters'),
];
// ─── Phone verification ───────────────────────────────────────────────────────
exports.sendPhoneOtpValidator = [
    (0, express_validator_1.body)('phone')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Phone must be a string')
        .isMobilePhone('any').withMessage('Must be a valid phone number'),
];
exports.verifyPhoneOtpValidator = [
    (0, express_validator_1.body)('otp')
        .exists({ checkFalsy: true }).withMessage('OTP is required')
        .isString().withMessage('OTP must be a string')
        .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits'),
];
// ─── Logout ───────────────────────────────────────────────────────────────────
exports.logoutValidator = [
    (0, express_validator_1.body)('refresh_token')
        .exists({ checkFalsy: true }).withMessage('Refresh token is required')
        .isString().withMessage('Refresh token must be a string'),
];
// ─── Refresh token ────────────────────────────────────────────────────────────
exports.refreshTokenValidator = [
    (0, express_validator_1.body)('refresh_token')
        .exists({ checkFalsy: true }).withMessage('Refresh token is required')
        .isString().withMessage('Refresh token must be a string'),
];
// ─── Forgot password ──────────────────────────────────────────────────────────
exports.forgotPasswordValidator = [
    (0, express_validator_1.body)('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),
];
exports.verifyForgotOtpValidator = [
    (0, express_validator_1.body)('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),
    (0, express_validator_1.body)('otp')
        .exists({ checkFalsy: true }).withMessage('OTP is required')
        .isString().withMessage('OTP must be a string')
        .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits'),
];
// ─── Reset password ───────────────────────────────────────────────────────────
exports.resetPasswordValidator = [
    (0, express_validator_1.body)('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),
    (0, express_validator_1.body)('otp')
        .exists({ checkFalsy: true }).withMessage('OTP is required')
        .isString().withMessage('OTP must be a string')
        .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits'),
    (0, express_validator_1.body)('password')
        .exists({ checkFalsy: true }).withMessage('New password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
];
// ─── Change password ──────────────────────────────────────────────────────────
exports.changePasswordValidator = [
    (0, express_validator_1.body)('old_password')
        .exists({ checkFalsy: true }).withMessage('Current password is required')
        .isString().withMessage('Current password must be a string'),
    (0, express_validator_1.body)('new_password')
        .exists({ checkFalsy: true }).withMessage('New password is required')
        .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number'),
];
// ─── Verify email ─────────────────────────────────────────────────────────────
exports.verifyEmailValidator = [
    (0, express_validator_1.body)('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),
    (0, express_validator_1.body)('otp')
        .exists({ checkFalsy: true }).withMessage('OTP is required')
        .isString().withMessage('OTP must be a string')
        .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits'),
];
// ─── Resend verification ──────────────────────────────────────────────────────
exports.resendVerificationValidator = [
    (0, express_validator_1.body)('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),
];
// ─── Submit ID verification ───────────────────────────────────────────────────
exports.submitIdVerificationValidator = [
    (0, express_validator_1.body)('document_type')
        .exists({ checkFalsy: true }).withMessage('Document type is required')
        .isIn(['nin', 'voters_card', 'passport', 'drivers_license'])
        .withMessage('document_type must be one of: nin, voters_card, passport, drivers_license'),
    (0, express_validator_1.body)('document_url')
        .exists({ checkFalsy: true }).withMessage('Document URL is required')
        .isString().withMessage('Document URL must be a string')
        .isURL({ protocols: ['https'], require_protocol: true })
        .withMessage('Document URL must be a valid HTTPS URL'),
];
//# sourceMappingURL=auth.validator.js.map