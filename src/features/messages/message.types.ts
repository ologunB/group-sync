import { Prisma } from '@prisma/client';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface SendMessageDTO {
    content?: string;
    message_type?: string;
    media_url?: string;
    reply_to_id?: string;
}

export interface ListMessagesQuery {
    cursor?: string;
    limit?: number;
    direction?: 'before' | 'after';
}

export interface ToggleChatLockDTO {
    locked: boolean;
}

// ─── Prisma selects ───────────────────────────────────────────────────────────

export const senderSnippetSelect = {
    id: true,
    displayName: true,
    profilePhotoUrl: true,
} satisfies Prisma.UserSelect;

export const messageSelect = {
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
    sender: { select: senderSnippetSelect },
    reactions: {
        select: { id: true, emoji: true, userId: true, createdAt: true },
    },
} satisfies Prisma.MessageSelect;

export type MessagePublic = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;
