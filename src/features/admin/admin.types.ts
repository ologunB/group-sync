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
}

export interface AdminUpdateGroupDTO {
    status?: 'active' | 'suspended';
    is_verified?: boolean;
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

export const adminUserSelect = {
    id: true,
    email: true,
    displayName: true,
    username: true,
    profilePhotoUrl: true,
    status: true,
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
    isVerified: true,
    memberCount: true,
    createdAt: true,
    deletedAt: true,
    creator: { select: { id: true, displayName: true, email: true } },
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
