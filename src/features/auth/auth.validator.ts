import { body, ValidationChain } from 'express-validator';

// ─── Register ─────────────────────────────────────────────────────────────────

export const registerValidator: ValidationChain[] = [
    body('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),

    body('password')
        .exists({ checkFalsy: true }).withMessage('Password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),

    body('display_name')
        .exists({ checkFalsy: true }).withMessage('Display name is required')
        .isString().withMessage('Display name must be a string')
        .trim()
        .isLength({ min: 2, max: 100 }).withMessage('Display name must be between 2 and 100 characters'),

    body('phone')
        .optional({ nullable: true, checkFalsy: true })
        .isString().withMessage('Phone must be a string')
        .isMobilePhone('any').withMessage('Must be a valid phone number'),
];

// ─── Login ────────────────────────────────────────────────────────────────────

export const loginValidator: ValidationChain[] = [
    body('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),

    body('password')
        .exists({ checkFalsy: true }).withMessage('Password is required')
        .isString().withMessage('Password must be a string'),
];

// ─── Social login ─────────────────────────────────────────────────────────────

export const socialLoginValidator: ValidationChain[] = [
    body('provider')
        .exists({ checkFalsy: true }).withMessage('Provider is required')
        .isIn(['google', 'apple']).withMessage('Provider must be "google" or "apple"'),

    body('token')
        .exists({ checkFalsy: true }).withMessage('Token is required')
        .isString().withMessage('Token must be a string'),
];

// ─── Logout ───────────────────────────────────────────────────────────────────

export const logoutValidator: ValidationChain[] = [
    body('refresh_token')
        .exists({ checkFalsy: true }).withMessage('Refresh token is required')
        .isString().withMessage('Refresh token must be a string'),
];

// ─── Refresh token ────────────────────────────────────────────────────────────

export const refreshTokenValidator: ValidationChain[] = [
    body('refresh_token')
        .exists({ checkFalsy: true }).withMessage('Refresh token is required')
        .isString().withMessage('Refresh token must be a string'),
];

// ─── Forgot password ──────────────────────────────────────────────────────────

export const forgotPasswordValidator: ValidationChain[] = [
    body('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),
];

export const verifyForgotOtpValidator: ValidationChain[] = [
    body('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),

    body('otp')
        .exists({ checkFalsy: true }).withMessage('OTP is required')
        .isString().withMessage('OTP must be a string')
        .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits'),
];

// ─── Reset password ───────────────────────────────────────────────────────────

export const resetPasswordValidator: ValidationChain[] = [
    body('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),

    body('otp')
        .exists({ checkFalsy: true }).withMessage('OTP is required')
        .isString().withMessage('OTP must be a string')
        .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits'),

    body('password')
        .exists({ checkFalsy: true }).withMessage('New password is required')
        .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
];

// ─── Change password ──────────────────────────────────────────────────────────

export const changePasswordValidator: ValidationChain[] = [
    body('old_password')
        .exists({ checkFalsy: true }).withMessage('Current password is required')
        .isString().withMessage('Current password must be a string'),

    body('new_password')
        .exists({ checkFalsy: true }).withMessage('New password is required')
        .isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number'),
];

// ─── Verify email ─────────────────────────────────────────────────────────────

export const verifyEmailValidator: ValidationChain[] = [
    body('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),

    body('otp')
        .exists({ checkFalsy: true }).withMessage('OTP is required')
        .isString().withMessage('OTP must be a string')
        .isLength({ min: 6, max: 6 }).withMessage('OTP must be exactly 6 digits'),
];

// ─── Resend verification ──────────────────────────────────────────────────────

export const resendVerificationValidator: ValidationChain[] = [
    body('email')
        .exists({ checkFalsy: true }).withMessage('Email is required')
        .isEmail().withMessage('Must be a valid email address')
        .normalizeEmail(),
];

// ─── Submit ID verification ───────────────────────────────────────────────────

export const submitIdVerificationValidator: ValidationChain[] = [
    body('document_type')
        .exists({ checkFalsy: true }).withMessage('Document type is required')
        .isIn(['nin', 'voters_card', 'passport', 'drivers_license'])
        .withMessage('document_type must be one of: nin, voters_card, passport, drivers_license'),

    body('document_url')
        .exists({ checkFalsy: true }).withMessage('Document URL is required')
        .isString().withMessage('Document URL must be a string')
        .isURL({ protocols: ['https'], require_protocol: true })
        .withMessage('Document URL must be a valid HTTPS URL'),
];
