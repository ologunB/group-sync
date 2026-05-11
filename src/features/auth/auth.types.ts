import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { TokenPayload } from '../../shared/types/common.types';

// ─── Request extension ────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
    user?: TokenPayload;
}

// ─── Request DTOs ─────────────────────────────────────────────────────────────

export interface RegisterDTO {
    email: string;
    password: string;
    display_name: string;
    phone?: string;
}

export interface LoginDTO {
    email: string;
    password: string;
}

export interface SocialLoginDTO {
    provider: 'google' | 'apple';
    token: string;
}

export interface LogoutDTO {
    refresh_token: string;
}

export interface RefreshTokenDTO {
    refresh_token: string;
}

export interface ForgotPasswordDTO {
    email: string;
}

export interface VerifyForgotOtpDTO {
    email: string;
    otp: string;
}

export interface ResetPasswordDTO {
    email: string;
    otp: string;
    password: string;
}

export interface ChangePasswordDTO {
    old_password: string;
    new_password: string;
}

export interface VerifyEmailDTO {
    email: string;
    otp: string;
}

export interface ResendVerificationDTO {
    email: string;
}

export interface SubmitIdVerificationDTO {
    document_type: 'nin' | 'voters_card' | 'passport' | 'drivers_license';
    document_url: string;
}

export interface KycWebhookDTO {
    event_id: string;
    user_id: string;
    status: 'approved' | 'rejected';
    reason?: string;
}

// ─── Service result types ─────────────────────────────────────────────────────

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

export interface RegisterResult {
    user: SafeUser;
}

export interface AuthResult {
    user: SafeUser;
    tokens: TokenPair;
    isNewUser?: boolean;
}

// ─── Safe user type — never includes sensitive fields ─────────────────────────

export interface SafeUser {
    id: string;
    email: string;
    displayName: string;
    username: string | null;
    profilePhotoUrl: string | null;
    bio: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    interests: string[];
    emailVerifiedAt: Date | null;
    idVerificationStatus: string;
    status: string;
    role: string;
    lastLoginAt: Date | null;
    preferredLanguage: string | null;
    createdAt: Date;
    updatedAt: Date;
}

// ─── Prisma select object (typed, reusable) ───────────────────────────────────

export const userSafeSelect = {
    id: true,
    email: true,
    displayName: true,
    username: true,
    profilePhotoUrl: true,
    bio: true,
    city: true,
    state: true,
    country: true,
    interests: true,
    emailVerifiedAt: true,
    idVerificationStatus: true,
    status: true,
    role: true,
    lastLoginAt: true,
    preferredLanguage: true,
    createdAt: true,
    updatedAt: true,
    // Explicitly NOT selected: phone, phoneIv, phoneHash, passwordHash, idDocumentUrl, idDocumentIv
} satisfies Prisma.UserSelect;

export type UserSafePayload = Prisma.UserGetPayload<{ select: typeof userSafeSelect }>;
