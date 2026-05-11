"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userSafeSelect = void 0;
// ─── Prisma select object (typed, reusable) ───────────────────────────────────
exports.userSafeSelect = {
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
    lastLoginAt: true,
    preferredLanguage: true,
    createdAt: true,
    updatedAt: true,
    // Explicitly NOT selected: phone, phoneIv, phoneHash, passwordHash, idDocumentUrl, idDocumentIv
};
//# sourceMappingURL=auth.types.js.map