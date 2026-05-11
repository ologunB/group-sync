"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dmSelect = void 0;
// ─── Prisma selects ───────────────────────────────────────────────────────────
exports.dmSelect = {
    id: true,
    senderId: true,
    receiverId: true,
    content: true,
    mediaUrl: true,
    isRead: true,
    createdAt: true,
    sender: { select: { id: true, displayName: true, profilePhotoUrl: true } },
    receiver: { select: { id: true, displayName: true, profilePhotoUrl: true } },
};
//# sourceMappingURL=dm.types.js.map