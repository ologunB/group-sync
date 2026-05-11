import { Prisma } from '@prisma/client';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface SendDmDTO {
    content?: string;
    media_url?: string;
}

export interface ListThreadQuery {
    cursor?: string;
    limit?: number;
}

// ─── Prisma selects ───────────────────────────────────────────────────────────

export const dmSelect = {
    id: true,
    senderId: true,
    receiverId: true,
    content: true,
    mediaUrl: true,
    isRead: true,
    createdAt: true,
    sender:   { select: { id: true, displayName: true, profilePhotoUrl: true } },
    receiver: { select: { id: true, displayName: true, profilePhotoUrl: true } },
} satisfies Prisma.DirectMessageSelect;

export type DmPublic = Prisma.DirectMessageGetPayload<{ select: typeof dmSelect }>;

// ─── Unified conversation item ─────────────────────────────────────────────────

export interface ConversationItem {
    type: 'group' | 'dm';
    id: string;              // groupId for group, otherUserId for dm
    name: string;
    avatar: string | null;
    is_chat_locked?: boolean;
    last_message: {
        id: string;
        content: string | null;
        sender_name: string | null;
        created_at: Date;
        is_deleted?: boolean;
    } | null;
    unread_count: number;
}
