"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dmSelect = void 0;
// ─── Prisma selects ───────────────────────────────────────────────────────────
exports.dmSelect = {
    id: true,
    senderId: true,
    receiverId: true,
    content: true,
    messageType: true,
    mediaUrl: true,
    mediaMimeType: true,
    replyToId: true,
    isRead: true,
    createdAt: true,
    sender: { select: { id: true, displayName: true, profilePhotoUrl: true } },
    receiver: { select: { id: true, displayName: true, profilePhotoUrl: true } },
    replyTo: {
        select: {
            id: true,
            content: true,
            messageType: true,
            mediaUrl: true,
            sender: { select: { id: true, displayName: true } },
        },
    },
    reactions: {
        select: { id: true, emoji: true, userId: true, createdAt: true },
    },
};
//# sourceMappingURL=dm.types.js.map