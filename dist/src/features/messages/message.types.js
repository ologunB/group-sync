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
        select: {
            id: true,
            emoji: true,
            userId: true,
            createdAt: true,
            user: { select: { id: true, displayName: true, profilePhotoUrl: true } },
        },
    },
    poll: {
        select: {
            id: true,
            question: true,
            isMultiple: true,
            endsAt: true,
            options: {
                select: {
                    id: true,
                    text: true,
                    position: true,
                    _count: { select: { votes: true } },
                    votes: { select: { userId: true } },
                },
                orderBy: { position: 'asc' },
            },
        },
    },
};
//# sourceMappingURL=message.types.js.map