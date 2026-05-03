import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { TokenPayload, PaginationMeta } from '../../shared/types/common.types';

// ─── Request extension ────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
    user?: TokenPayload;
}

// ─── Request DTOs ─────────────────────────────────────────────────────────────

export interface UpdateProfileDTO {
    display_name?: string;
    username?: string;
    bio?: string;
    city?: string;
    state?: string;
    country?: string;
    lat?: number;
    lng?: number;
    profile_photo_url?: string;
    preferred_language?: string;
}

export interface UpdateInterestsDTO {
    interests: string[];
}

// ─── Prisma select objects ────────────────────────────────────────────────────

/**
 * Full profile returned to the owning user only (GET /users/me).
 * Includes email — never returned to other users.
 * Never includes: phone, phoneIv, passwordHash, idDocumentUrl, idDocumentIv.
 */
export const selfProfileSelect = {
    id: true,
    email: true,               // returned to self only
    displayName: true,
    username: true,
    profilePhotoUrl: true,
    bio: true,
    city: true,
    state: true,
    country: true,
    interests: true,
    emailVerifiedAt: true,
    idVerificationStatus: true, // returned to self only
    status: true,
    lastLoginAt: true,
    preferredLanguage: true,
    createdAt: true,
    updatedAt: true,
    // Explicitly omitted: phone, phoneIv, passwordHash, idDocumentUrl, idDocumentIv, deletedAt
} satisfies Prisma.UserSelect;

/**
 * Public profile returned to other authenticated users (GET /users/:id).
 * Strips email, id_verification_status, and all sensitive fields.
 */
export const publicProfileSelect = {
    id: true,
    displayName: true,
    username: true,
    profilePhotoUrl: true,
    bio: true,
    city: true,
    interests: true,
    createdAt: true,
    // Explicitly omitted: email, state, country, idVerificationStatus,
    //                     phone, phoneIv, passwordHash, idDocumentUrl, idDocumentIv
} satisfies Prisma.UserSelect;

/**
 * Minimal user shape attached to membership/group list results.
 */
export const memberSnippetSelect = {
    id: true,
    displayName: true,
    username: true,
    profilePhotoUrl: true,
} satisfies Prisma.UserSelect;

// ─── Result types ─────────────────────────────────────────────────────────────

export type SelfProfile    = Prisma.UserGetPayload<{ select: typeof selfProfileSelect }>;
export type PublicProfile  = Prisma.UserGetPayload<{ select: typeof publicProfileSelect }>;
export type MemberSnippet  = Prisma.UserGetPayload<{ select: typeof memberSnippetSelect }>;

// ─── Paginated result wrappers ────────────────────────────────────────────────

export interface PaginatedResult<T> {
    data: T[];
    pagination: PaginationMeta;
}

// ─── Group membership list item (GET /users/me/groups) ───────────────────────

export interface MyGroupItem {
    group: {
        id: string;
        name: string;
        slug: string;
        category: string;
        subcategory: string | null;
        coverImageUrl: string | null;
        logoUrl: string | null;
        city: string | null;
        state: string | null;
        country: string | null;
        memberCount: number;
        isVerified: boolean;
        membershipType: string;
        status: string;
    };
    membership: {
        role: string;
        status: string;
        joinedAt: Date;
    };
}

// ─── Application list item (GET /users/me/applications) ──────────────────────

export interface MyApplicationItem {
    id: string;
    status: string;
    formResponses: Prisma.JsonValue;
    rejectionReason: string | null;
    submittedAt: Date;
    reviewedAt: Date | null;
    group: {
        id: string;
        name: string;
        slug: string;
        category: string;
        coverImageUrl: string | null;
        logoUrl: string | null;
    };
}
