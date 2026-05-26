import { Prisma } from '@prisma/client';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface SendPollDTO {
    question: string;
    options: string[];      // 2–10 option texts
    is_multiple?: boolean;  // allow multiple votes; default false
    ends_at?: string;       // ISO date string
}

export interface SendMessageDTO {
    content?: string;
    message_type?: string;
    media_url?: string;
    reply_to_id?: string;
    poll?: SendPollDTO;
}

export interface VotePollDTO {
    option_id: string;
}

export interface UploadedMessageMedia {
    buffer: Buffer;
    mimeType: string;
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
                orderBy: { position: 'asc' as const },
            },
        },
    },
} satisfies Prisma.MessageSelect;

export type MessagePublic = Prisma.MessageGetPayload<{ select: typeof messageSelect }>;
