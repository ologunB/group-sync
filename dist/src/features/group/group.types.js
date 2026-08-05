"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.groupAdminSelect = exports.groupPublicSelect = exports.GROUP_REVIEW_STATUSES = exports.GROUP_DESCRIPTION_MAX = exports.GROUP_DESCRIPTION_MIN = void 0;
// Group descriptions carry the whole pitch on a discovery card, so they are held to a
// real length. Enforced in the validator; the constants live here so the review queue
// and the docs quote the same numbers.
exports.GROUP_DESCRIPTION_MIN = 40;
exports.GROUP_DESCRIPTION_MAX = 500;
exports.GROUP_REVIEW_STATUSES = ['pending', 'approved', 'rejected'];
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
    reviewStatus: true,
    createdAt: true,
    updatedAt: true,
    createdBy: true,
};
exports.groupAdminSelect = {
    ...exports.groupPublicSelect,
    deletedAt: true,
};
//# sourceMappingURL=group.types.js.map