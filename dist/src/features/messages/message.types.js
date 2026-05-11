"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageSelect = exports.senderSnippetSelect = void 0;
// ─── Prisma selects ───────────────────────────────────────────────────────────
exports.senderSnippetSelect = {
    id: true,
    displayName: true,
    profilePhotoUrl: true,
};
exports.messageSelect = {
    id: true,
    groupId: true,
    senderId: true,
    content: true,
    messageType: true,
    mediaUrl: true,
    replyToId: true,
    isPinned: true,
    isDeleted: true,
    createdAt: true,
    updatedAt: true,
    sender: { select: exports.senderSnippetSelect },
    reactions: {
        select: { id: true, emoji: true, userId: true, createdAt: true },
    },
};
//# sourceMappingURL=message.types.js.map