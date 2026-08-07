import { Prisma } from '@prisma/client';

export interface AdminListUsersQuery {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
}

export interface AdminUpdateUserDTO {
    status: 'active' | 'suspended' | 'banned';
}

export interface AdminVerifyIdDTO {
    decision: 'approved' | 'rejected';
    rejection_reason?: string;
}

export interface AdminListGroupsQuery {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    review_status?: 'pending' | 'approved' | 'rejected';
}

export interface AdminUpdateGroupDTO {
    status?: 'active' | 'suspended';
    is_verified?: boolean;
}

export interface AdminReviewGroupDTO {
    decision: 'approve' | 'reject';
    /** Shown to the organiser verbatim when rejecting, so it should be actionable. */
    notes?: string;
}

/**
 * A row in the moderation queue. Carries the creator's contact-verification state
 * alongside the group, because "is this a real organiser?" is the actual question a
 * reviewer is answering and it should not need a second lookup.
 */
export interface PendingGroupItem {
    id: string;
    name: string;
    slug: string;
    category: string;
    description: string | null;
    coverImageUrl: string | null;
    city: string | null;
    state: string | null;
    memberCount: number;
    createdAt: Date;
    creator: {
        id: string;
        displayName: string;
        email: string;
        bio: string | null;
        phoneVerified: boolean;
        emailVerified: boolean;
        idVerificationStatus: string;
        /** How many groups this account has created, including this one. */
        groupsCreated: number;
    } | null;
}

export interface AdminListReportsQuery {
    page?: number;
    limit?: number;
    status?: string;
}

export interface AdminResolveReportDTO {
    action: 'resolved' | 'dismissed';
}

export interface AdminListAuditLogsQuery {
    page?: number;
    limit?: number;
    user_id?: string;
    action?: string;
    entity_type?: string;
    date_from?: string;
    date_to?: string;
}

export interface AdminChangeRoleDTO {
    role: 'user' | 'admin' | 'super_admin';
}

export interface PlatformStats {
    users: {
        total: number;
        active: number;
        suspended: number;
        banned: number;
        new_today: number;
        new_this_week: number;
        pending_verification: number;
        platform_admins: number;
    };
    groups: {
        total: number;
        active: number;
        suspended: number;
        verified: number;
        new_this_week: number;
    };
    content: {
        messages_total: number;
        messages_today: number;
        dms_total: number;
        dms_today: number;
    };
    moderation: {
        reports_open: number;
        reports_resolved_today: number;
        pending_id_verifications: number;
    };
}

export const adminUserSelect = {
    id: true,
    email: true,
    displayName: true,
    username: true,
    profilePhotoUrl: true,
    status: true,
    role: true,
    idVerificationStatus: true,
    createdAt: true,
    lastLoginAt: true,
    deletedAt: true,
} as const satisfies Prisma.UserSelect;

export const adminGroupSelect = {
    id: true,
    name: true,
    slug: true,
    category: true,
    status: true,
    reviewStatus: true,
    reviewedAt: true,
    reviewNotes: true,
    isVerified: true,
    isDiscoverable: true,
    coverImageUrl: true,
    memberCount: true,
    createdAt: true,
    deletedAt: true,
    creator: { select: { id: true, displayName: true, email: true } },
} as const satisfies Prisma.GroupSelect;

/** Everything a reviewer needs to judge a pending group in one query. */
export const adminPendingGroupSelect = {
    id: true,
    name: true,
    slug: true,
    category: true,
    description: true,
    coverImageUrl: true,
    city: true,
    state: true,
    memberCount: true,
    createdAt: true,
    creator: {
        select: {
            id: true,
            displayName: true,
            email: true,
            bio: true,
            phoneVerifiedAt: true,
            emailVerifiedAt: true,
            idVerificationStatus: true,
            _count: { select: { groupsCreated: true } },
        },
    },
} as const satisfies Prisma.GroupSelect;

export const adminReportSelect = {
    id: true,
    reporterId: true,
    targetType: true,
    targetId: true,
    reason: true,
    description: true,
    status: true,
    reviewedBy: true,
    reviewedAt: true,
    createdAt: true,
    reporter: { select: { id: true, displayName: true, email: true } },
} as const satisfies Prisma.ReportSelect;

export const adminAuditSelect = {
    id: true,
    userId: true,
    action: true,
    entityType: true,
    entityId: true,
    status: true,
    description: true,
    ipAddress: true,
    metadata: true,
    createdAt: true,
} as const satisfies Prisma.AuditLogSelect;

// ─── Taxonomy (admin-managed categories and interests) ────────────────────────

export interface AdminListTaxonomyQuery {
    /** Admin views default to showing deactivated rows too — that is the point of the screen. */
    include_inactive?: boolean;
}

export interface AdminCreateCategoryDTO {
    value: string;
    label?: string;
    sort_order?: number;
    is_active?: boolean;
}

export interface AdminUpdateCategoryDTO {
    label?: string;
    sort_order?: number;
    is_active?: boolean;
}

export interface AdminCreateInterestDTO {
    value: string;
    label?: string;
    group: string;
    sort_order?: number;
    is_active?: boolean;
}

export interface AdminUpdateInterestDTO {
    label?: string;
    group?: string;
    sort_order?: number;
    is_active?: boolean;
}

export const adminCategorySelect = {
    id: true,
    value: true,
    label: true,
    isActive: true,
    sortOrder: true,
    createdAt: true,
    updatedAt: true,
} as const satisfies Prisma.CategorySelect;

export const adminInterestSelect = {
    id: true,
    value: true,
    label: true,
    group: true,
    isActive: true,
    sortOrder: true,
    createdAt: true,
    updatedAt: true,
} as const satisfies Prisma.InterestSelect;

// ─── Event moderation ─────────────────────────────────────────────────────────

export interface AdminListEventsQuery {
    page?: number;
    limit?: number;
    status?: 'scheduled' | 'cancelled' | 'completed';
    search?: string;
    /** 'upcoming' | 'past' — filters on starts_at relative to now. */
    when?: 'upcoming' | 'past';
}

export interface AdminCancelEventDTO {
    reason: string;
}

export const adminEventSelect = {
    id: true,
    title: true,
    description: true,
    startsAt: true,
    endsAt: true,
    status: true,
    visibility: true,
    rsvpCount: true,
    rsvpLimit: true,
    venueCity: true,
    venueState: true,
    createdAt: true,
    group: { select: { id: true, name: true, slug: true, category: true } },
    creator: { select: { id: true, displayName: true, email: true } },
} as const satisfies Prisma.EventSelect;
