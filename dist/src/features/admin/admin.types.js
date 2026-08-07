"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminEventSelect = exports.adminInterestSelect = exports.adminCategorySelect = exports.adminAuditSelect = exports.adminReportSelect = exports.adminPendingGroupSelect = exports.adminGroupSelect = exports.adminUserSelect = void 0;
exports.adminUserSelect = {
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
};
exports.adminGroupSelect = {
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
};
/** Everything a reviewer needs to judge a pending group in one query. */
exports.adminPendingGroupSelect = {
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
};
exports.adminReportSelect = {
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
};
exports.adminAuditSelect = {
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
};
exports.adminCategorySelect = {
    id: true,
    value: true,
    label: true,
    isActive: true,
    sortOrder: true,
    createdAt: true,
    updatedAt: true,
};
exports.adminInterestSelect = {
    id: true,
    value: true,
    label: true,
    group: true,
    isActive: true,
    sortOrder: true,
    createdAt: true,
    updatedAt: true,
};
exports.adminEventSelect = {
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
};
//# sourceMappingURL=admin.types.js.map