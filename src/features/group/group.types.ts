import { Request } from 'express';
import { Prisma } from '@prisma/client';
import { TokenPayload, PaginationMeta } from '../../shared/types/common.types';

// ─── Request extension ────────────────────────────────────────────────────────

export interface AuthenticatedRequest extends Request {
    user?: TokenPayload;
}

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreateGroupDTO {
    name: string;
    category: string;
    subcategory?: string;
    description?: string;
    city?: string;
    state?: string;
    country?: string;
    lat?: number;
    lng?: number;
    membership_type?: 'open' | 'application' | 'invite_only';
    membership_fee?: number;
    membership_fee_currency?: string;
    membership_fee_frequency?: 'one_time' | 'monthly' | 'yearly';
    how_to_join_content?: string;
    rules?: string;
    cover_image_url?: string;
    logo_url?: string;
    founding_date?: string; // ISO8601 date string
}

export interface UpdateGroupDTO {
    name?: string;
    category?: string;
    subcategory?: string;
    description?: string;
    city?: string;
    state?: string;
    country?: string;
    lat?: number;
    lng?: number;
    membership_type?: 'open' | 'application' | 'invite_only';
    membership_fee?: number;
    membership_fee_currency?: string;
    membership_fee_frequency?: 'one_time' | 'monthly' | 'yearly';
    how_to_join_content?: string;
    rules?: string;
    cover_image_url?: string;
    logo_url?: string;
    founding_date?: string;
}

// Group descriptions carry the whole pitch on a discovery card, so they are held to a
// real length. Enforced in the validator; the constants live here so the review queue
// and the docs quote the same numbers.
export const GROUP_DESCRIPTION_MIN = 40;
export const GROUP_DESCRIPTION_MAX = 500;

export const GROUP_REVIEW_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type GroupReviewStatus = (typeof GROUP_REVIEW_STATUSES)[number];

export interface ListGroupsQuery {
    q?: string;
    category?: string;
    subcategory?: string;
    city?: string;
    state?: string;
    country?: string;
    lat?: number;
    lng?: number;
    radius_km?: number;
    membership_type?: string;
    min_members?: number;
    max_members?: number;
    is_verified?: boolean;
    sort?: 'relevance' | 'distance' | 'newest' | 'most_members';
    page?: number;
    limit?: number;
}

// ─── Prisma select shapes ─────────────────────────────────────────────────────

export const groupPublicSelect = {
    id: true,
    name: true,
    slug: true,
    category: true,
    subcategory: true,
    description: true,
    coverImageUrl: true,
    logoUrl: true,
    city: true,
    state: true,
    country: true,
    membershipType: true,
    membershipFee: true,
    membershipFeeCurrency: true,
    membershipFeeFrequency: true,
    howToJoinContent: true,
    rules: true,
    foundingDate: true,
    isVerified: true,
    isDiscoverable: true,
    memberCount: true,
    status: true,
    reviewStatus: true,
    createdAt: true,
    updatedAt: true,
    createdBy: true,
} satisfies Prisma.GroupSelect;

export const groupAdminSelect = {
    ...groupPublicSelect,
    deletedAt: true,
} satisfies Prisma.GroupSelect;

type GroupRow = Prisma.GroupGetPayload<{ select: typeof groupPublicSelect }>;

/**
 * What a group looks like on the wire.
 *
 * `isActiveThisMonth` replaces the old "NEW" badge: a group is active when it has an
 * event starting inside the activity window (30 days by default), which is a claim
 * about the group actually doing something rather than about its signup date.
 *
 * `isPublished` answers "would a stranger find this in Explore?" — it folds together
 * review approval, the cover-image requirement, discoverability and status, so the
 * organiser's dashboard does not have to re-derive the rule.
 */
export interface GroupPublic extends GroupRow {
    isActiveThisMonth?: boolean;
    isPublished?: boolean;
}

export type GroupAdmin  = Prisma.GroupGetPayload<{ select: typeof groupAdminSelect }>;

/** Everything blocking a group from appearing in Explore, shown to its organisers. */
export interface PublishingChecklist {
    reviewStatus: GroupReviewStatus;
    reviewMessage: string | null;
    hasCoverImage: boolean;
    isDiscoverable: boolean;
    isPublished: boolean;
    /** Human-readable list of what is still outstanding. Empty when published. */
    blockers: string[];
}

// ─── Member list item ─────────────────────────────────────────────────────────

export interface GroupMemberItem {
    userId: string;
    displayName: string;
    username: string | null;
    profilePhotoUrl: string | null;
    role: string;
    status: string;
    joinedAt: Date;
}

// ─── Stats result ─────────────────────────────────────────────────────────────

export interface GroupStats {
    memberCount: number;
    pendingApplications: number;
    totalApplications: number;
    upcomingEvents: number;
    messagesLast7Days: number;
}

// ─── Paginated result ─────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
    data: T[];
    pagination: PaginationMeta;
}

// ─── Group with caller membership status ──────────────────────────────────────

export interface GroupProfileResult {
    group: GroupPublic;
    callerMembershipStatus: {
        isMember: boolean;
        role: string | null;
        status: string | null;
        joinedAt: Date | null;
    } | null;
    /** Only populated for the group's admins — nobody else needs to see the blockers. */
    publishingChecklist: PublishingChecklist | null;
}
