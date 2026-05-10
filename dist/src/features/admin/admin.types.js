"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuditSelect = exports.adminReportSelect = exports.adminGroupSelect = exports.adminUserSelect = void 0;
exports.adminUserSelect = {
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
};
exports.adminGroupSelect = {
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
//# sourceMappingURL=admin.types.js.map