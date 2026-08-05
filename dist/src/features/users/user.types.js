"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.memberSnippetSelect = exports.publicProfileSelect = exports.selfProfileSelect = void 0;
// ─── Prisma select objects ────────────────────────────────────────────────────
/**
 * Full profile returned to the owning user only (GET /users/me).
 * Includes email — never returned to other users.
 * Never includes: phone, phoneIv, passwordHash, idDocumentUrl, idDocumentIv.
 */
exports.selfProfileSelect = {
    id: true,
    email: true, // returned to self only
    displayName: true,
    username: true,
    profilePhotoUrl: true,
    bio: true,
    city: true,
    state: true,
    country: true,
    interests: true,
    emailVerifiedAt: true,
    phoneVerifiedAt: true, // returned to self only — drives the verification prompts
    idVerificationStatus: true, // returned to self only
    status: true,
    lastLoginAt: true,
    preferredLanguage: true,
    createdAt: true,
    updatedAt: true,
    // Explicitly omitted: phone, phoneIv, passwordHash, idDocumentUrl, idDocumentIv, deletedAt
};
/**
 * Public profile returned to other authenticated users (GET /users/:id).
 * Strips email, id_verification_status, and all sensitive fields.
 */
exports.publicProfileSelect = {
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
};
/**
 * Minimal user shape attached to membership/group list results.
 */
exports.memberSnippetSelect = {
    id: true,
    displayName: true,
    username: true,
    profilePhotoUrl: true,
};
//# sourceMappingURL=user.types.js.map