"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupAdminSelect = exports.groupPublicSelect = void 0;
// ─── Prisma select shapes ─────────────────────────────────────────────────────
exports.groupPublicSelect = {
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
    createdAt: true,
    updatedAt: true,
    createdBy: true,
};
exports.groupAdminSelect = {
    ...exports.groupPublicSelect,
    deletedAt: true,
};
//# sourceMappingURL=group.types.js.map