import { Prisma } from '@prisma/client';

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface CreatePostDTO {
    content?: string;
    link_url?: string;
}

export interface UpdatePostDTO {
    content?: string;
    link_url?: string;
}

export interface ListFeedQuery {
    cursor?: string;
    limit?: number;
}

export interface CreateCommentDTO {
    content: string;
    parent_id?: string;
}

export interface UpdateCommentDTO {
    content: string;
}

export interface UploadedPostMedia {
    buffer: Buffer;
    mimeType: string;
}

// ─── Prisma selects ───────────────────────────────────────────────────────────

const authorSnippet = {
    id: true,
    displayName: true,
    profilePhotoUrl: true,
} satisfies Prisma.UserSelect;

export const postReactionSelect = {
    id: true,
    emoji: true,
    userId: true,
    createdAt: true,
    user: { select: authorSnippet },
} satisfies Prisma.GroupPostReactionSelect;

export const commentReactionSelect = {
    id: true,
    emoji: true,
    userId: true,
    createdAt: true,
    user: { select: authorSnippet },
} satisfies Prisma.GroupPostCommentReactionSelect;

export const commentSelect = {
    id: true,
    postId: true,
    parentId: true,
    content: true,
    isDeleted: true,
    createdAt: true,
    updatedAt: true,
    author: { select: authorSnippet },
    reactions: { select: commentReactionSelect },
    _count: { select: { replies: { where: { isDeleted: false } } } },
} satisfies Prisma.GroupPostCommentSelect;

export const postSelect = {
    id: true,
    groupId: true,
    authorId: true,
    content: true,
    mediaUrls: true,
    linkUrl: true,
    isPublic: true,
    isPinned: true,
    isDeleted: true,
    createdAt: true,
    updatedAt: true,
    author: { select: authorSnippet },
    reactions: { select: postReactionSelect },
    _count: { select: { comments: { where: { isDeleted: false } } } },
} satisfies Prisma.GroupPostSelect;

export type PostPublic    = Prisma.GroupPostGetPayload<{ select: typeof postSelect }>;
export type CommentPublic = Prisma.GroupPostCommentGetPayload<{ select: typeof commentSelect }>;
