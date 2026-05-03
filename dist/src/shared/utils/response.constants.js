"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Messages = void 0;
exports.Messages = {
    // Generic
    SERVER_ERROR: 'An internal server error occurred. Please try again later.',
    VALIDATION_FAILED: 'Validation failed.',
    SUCCESS: 'Operation completed successfully.',
    // Auth
    REGISTERED: 'Account created successfully. Please check your email to verify your account.',
    LOGGED_IN: 'Login successful.',
    LOGGED_OUT: 'Logged out successfully.',
    TOKEN_REFRESHED: 'Tokens refreshed successfully.',
    PASSWORD_RESET_EMAIL_SENT: 'If an account with that email exists, a password reset code has been sent.',
    PASSWORD_RESET_SUCCESS: 'Password has been reset successfully.',
    PASSWORD_CHANGED: 'Password changed successfully.',
    EMAIL_VERIFIED: 'Email verified successfully.',
    VERIFICATION_EMAIL_SENT: 'A verification code has been sent to your email.',
    ID_VERIFICATION_SUBMITTED: 'Identity document submitted for review.',
    // Token errors
    TOKEN_EXPIRED: 'Your session has expired. Please log in again.',
    TOKEN_MALFORMED: 'Invalid or malformed authentication token.',
    REFRESH_TOKEN_INVALID: 'Invalid or expired refresh token.',
    // Credential / account errors
    INVALID_CREDENTIALS: 'Invalid email or password.',
    INCORRECT_OLD_PASSWORD: 'The current password you entered is incorrect.',
    INVALID_VERIFICATION_CODE: 'The verification code is invalid or has expired.',
    EMAIL_ALREADY_EXISTS: 'An account with this email address already exists.',
    USERNAME_TAKEN: 'This username is already taken.',
    ACCOUNT_SUSPENDED: 'Your account has been suspended. Please contact support.',
    ACCOUNT_BANNED: 'Your account has been permanently banned.',
    ACCOUNT_LOCKED: 'Your account is temporarily locked due to too many failed login attempts. Please try again in 15 minutes.',
    // Verification gates
    EMAIL_NOT_VERIFIED: 'Please verify your email address before proceeding.',
    ID_NOT_VERIFIED: 'You must complete identity verification to perform this action.',
    KYC_ALREADY_SUBMITTED: 'Your identity document has already been submitted for review.',
    KYC_ALREADY_VERIFIED: 'Your identity has already been verified.',
    // Authorization
    UNAUTHORIZED: 'Authentication required. Please log in to continue.',
    FORBIDDEN: 'Access denied. You do not have permission to perform this action.',
    // Social auth
    SOCIAL_TOKEN_INVALID: 'Could not verify the social login token. Please try again.',
    PROVIDER_ALREADY_LINKED: 'This social account is already linked to another user.',
    // Resource helpers
    RESOURCE_NOT_FOUND: (resource) => `${resource} not found.`,
    ALREADY_EXISTS: (resource) => `${resource} already exists.`,
    // User actions
    PROFILE_UPDATED: 'Profile updated successfully.',
    ACCOUNT_DELETED: 'Account deleted successfully.',
    USER_BLOCKED: 'User blocked successfully.',
    USER_UNBLOCKED: 'User unblocked successfully.',
    CANNOT_SELF_BLOCK: 'You cannot block yourself.',
};
//# sourceMappingURL=response.constants.js.map