import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../database/connection';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import { asLogger } from '../../shared/utils/asLogger';
import { AuditLogger, LogActions, ResourceTypes } from '../../shared/utils/audit.logger';
import { TokenPayload } from '../../shared/types/common.types';
import { StorageService } from '../../shared/storage/storage.service';
import {
    CreatePostDTO,
    UpdatePostDTO,
    ListFeedQuery,
    CreateCommentDTO,
    UpdateCommentDTO,
    UploadedPostMedia,
    PostPublic,
    CommentPublic,
    postSelect,
    commentSelect,
} from './feed.types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getActiveMembership(groupId: string, userId: string) {
    return prisma.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { role: true, status: true },
    });
}

async function requireActiveMember(groupId: string, userId: string): Promise<{ role: string }> {
    const m = await getActiveMembership(groupId, userId);
    if (!m || m.status !== 'active') throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
    return m;
}

async function requireGroupAdmin(groupId: string, userId: string): Promise<void> {
    const m = await getActiveMembership(groupId, userId);
    if (!m || m.status !== 'active' || !['super_admin', 'admin'].includes(m.role)) {
        throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
    }
}

async function resolvePostGroup(postId: string): Promise<{ groupId: string; authorId: string; isDeleted: boolean }> {
    const post = await prisma.groupPost.findUnique({
        where: { id: postId },
        select: { groupId: true, authorId: true, isDeleted: true },
    });
    if (!post || post.isDeleted) {
        throw new ApiError(Messages.RESOURCE_NOT_FOUND('Post'), StatusCodes.NOT_FOUND);
    }
    return post;
}

async function resolveCommentGroup(commentId: string): Promise<{ postId: string; groupId: string; authorId: string; isDeleted: boolean }> {
    const comment = await prisma.groupPostComment.findUnique({
        where: { id: commentId },
        select: { postId: true, authorId: true, isDeleted: true, post: { select: { groupId: true } } },
    });
    if (!comment || comment.isDeleted) {
        throw new ApiError(Messages.RESOURCE_NOT_FOUND('Comment'), StatusCodes.NOT_FOUND);
    }
    return { postId: comment.postId, groupId: comment.post.groupId, authorId: comment.authorId, isDeleted: comment.isDeleted };
}

// ─── FeedService ──────────────────────────────────────────────────────────────

export class FeedService {

    // ── List feed ─────────────────────────────────────────────────────────────

    async listFeed(
        groupId: string,
        query: ListFeedQuery,
        actorId: string | null,
    ): Promise<{
        pinned: PostPublic[];
        data: PostPublic[];
        next_cursor: string | null;
        has_more: boolean;
    }> {
        try {
            const group = await prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, status: true, deletedAt: true },
            });
            if (!group || group.deletedAt || group.status !== 'active') {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }

            const membership = actorId
                ? await getActiveMembership(groupId, actorId)
                : null;
            const isMember = membership?.status === 'active';

            const limit = Math.min(query.limit ?? 20, 50);
            const publicFilter = isMember ? {} : { isPublic: true };

            // Pinned posts — always returned in full (no pagination)
            const pinned = await prisma.groupPost.findMany({
                where: { groupId, isPinned: true, isDeleted: false, ...publicFilter },
                select: postSelect,
                orderBy: { createdAt: 'desc' },
            });

            // Cursor-paginated non-pinned posts
            const cursorWhere = query.cursor
                ? { createdAt: { lt: (await prisma.groupPost.findUnique({ where: { id: query.cursor }, select: { createdAt: true } }))?.createdAt } }
                : {};

            const data = await prisma.groupPost.findMany({
                where: { groupId, isPinned: false, isDeleted: false, ...publicFilter, ...cursorWhere },
                select: postSelect,
                orderBy: { createdAt: 'desc' },
                take: limit + 1,
            });

            const has_more = data.length > limit;
            if (has_more) data.pop();

            return {
                pinned,
                data,
                next_cursor: has_more ? data[data.length - 1].id : null,
                has_more,
            };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.listFeed:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Get single post ───────────────────────────────────────────────────────

    async getPost(postId: string, actorId: string | null): Promise<PostPublic> {
        try {
            const post = await prisma.groupPost.findUnique({
                where: { id: postId },
                select: postSelect,
            });
            if (!post || post.isDeleted) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Post'), StatusCodes.NOT_FOUND);
            }

            if (!post.isPublic) {
                if (!actorId) throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
                await requireActiveMember(post.groupId, actorId);
            }

            return post;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.getPost:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Create post ───────────────────────────────────────────────────────────

    async createPost(
        groupId: string,
        dto: CreatePostDTO,
        actor: TokenPayload,
        files?: UploadedPostMedia[],
    ): Promise<PostPublic> {
        try {
            const group = await prisma.group.findUnique({
                where: { id: groupId },
                select: { id: true, status: true, deletedAt: true },
            });
            if (!group || group.deletedAt || group.status !== 'active') {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }

            await requireActiveMember(groupId, actor.userId);

            if (!dto.content?.trim() && !dto.link_url && (!files || files.length === 0)) {
                throw new ApiError(
                    'A post must have content, a link, or at least one image.',
                    StatusCodes.UNPROCESSABLE_ENTITY,
                );
            }

            // Upload images to storage
            let mediaUrls: string[] = [];
            if (files && files.length > 0) {
                const uploads = await Promise.all(
                    files.map((f) => StorageService.upload(f.buffer, f.mimeType, { folder: 'feed' })),
                );
                mediaUrls = uploads.map((u) => u.url);
            }

            const post = await prisma.groupPost.create({
                data: {
                    groupId,
                    authorId: actor.userId,
                    content:   dto.content?.trim() ?? null,
                    mediaUrls,
                    linkUrl:   dto.link_url ?? null,
                },
                select: postSelect,
            });

            AuditLogger.log(actor, LogActions.FEED_POST_CREATE, ResourceTypes.FEED_POST, post.id, 1, { groupId });
            return post;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.createPost:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Update post ───────────────────────────────────────────────────────────

    async updatePost(postId: string, dto: UpdatePostDTO, actor: TokenPayload): Promise<PostPublic> {
        try {
            const { groupId, authorId } = await resolvePostGroup(postId);

            if (authorId !== actor.userId) {
                throw new ApiError('You can only edit your own posts.', StatusCodes.FORBIDDEN);
            }

            if (!dto.content?.trim() && !dto.link_url) {
                throw new ApiError('Provide content or a link_url to update.', StatusCodes.BAD_REQUEST);
            }

            const post = await prisma.groupPost.update({
                where: { id: postId },
                data: {
                    content: dto.content !== undefined ? (dto.content.trim() || null) : undefined,
                    linkUrl: dto.link_url !== undefined ? (dto.link_url || null) : undefined,
                },
                select: postSelect,
            });

            AuditLogger.log(actor, LogActions.FEED_POST_UPDATE, ResourceTypes.FEED_POST, postId, 1, { groupId });
            return post;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.updatePost:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Delete post ───────────────────────────────────────────────────────────

    async deletePost(postId: string, actor: TokenPayload): Promise<void> {
        try {
            const { groupId, authorId } = await resolvePostGroup(postId);

            if (authorId !== actor.userId) {
                // Must be a group admin to delete someone else's post
                await requireGroupAdmin(groupId, actor.userId);
            }

            await prisma.groupPost.update({
                where: { id: postId },
                data: { isDeleted: true },
            });

            AuditLogger.log(actor, LogActions.FEED_POST_DELETE, ResourceTypes.FEED_POST, postId, 1, { groupId });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.deletePost:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Toggle pin ────────────────────────────────────────────────────────────

    async togglePin(postId: string, actor: TokenPayload): Promise<PostPublic> {
        try {
            const post = await prisma.groupPost.findUnique({
                where: { id: postId },
                select: { id: true, groupId: true, isPinned: true, isDeleted: true },
            });
            if (!post || post.isDeleted) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Post'), StatusCodes.NOT_FOUND);
            }

            await requireGroupAdmin(post.groupId, actor.userId);

            const updated = await prisma.groupPost.update({
                where: { id: postId },
                data: { isPinned: !post.isPinned },
                select: postSelect,
            });

            AuditLogger.log(actor, LogActions.FEED_POST_PIN, ResourceTypes.FEED_POST, postId, 1, {
                groupId: post.groupId,
                isPinned: updated.isPinned,
            });
            return updated;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.togglePin:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Toggle public visibility ──────────────────────────────────────────────

    async toggleVisibility(postId: string, actor: TokenPayload): Promise<PostPublic> {
        try {
            const post = await prisma.groupPost.findUnique({
                where: { id: postId },
                select: { id: true, groupId: true, isPublic: true, isDeleted: true },
            });
            if (!post || post.isDeleted) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Post'), StatusCodes.NOT_FOUND);
            }

            await requireGroupAdmin(post.groupId, actor.userId);

            const updated = await prisma.groupPost.update({
                where: { id: postId },
                data: { isPublic: !post.isPublic },
                select: postSelect,
            });

            AuditLogger.log(actor, LogActions.FEED_POST_VISIBILITY, ResourceTypes.FEED_POST, postId, 1, {
                groupId: post.groupId,
                isPublic: updated.isPublic,
            });
            return updated;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.toggleVisibility:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Post reactions ────────────────────────────────────────────────────────

    async addPostReaction(postId: string, emoji: string, actor: TokenPayload): Promise<void> {
        try {
            const { groupId } = await resolvePostGroup(postId);
            await requireActiveMember(groupId, actor.userId);

            const existing = await prisma.groupPostReaction.findUnique({
                where: { postId_userId_emoji: { postId, userId: actor.userId, emoji } },
                select: { id: true },
            });
            if (existing) throw new ApiError('You already reacted with this emoji.', StatusCodes.CONFLICT);

            await prisma.groupPostReaction.create({
                data: { postId, userId: actor.userId, emoji },
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.addPostReaction:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async removePostReaction(postId: string, emoji: string, actor: TokenPayload): Promise<void> {
        try {
            const reaction = await prisma.groupPostReaction.findUnique({
                where: { postId_userId_emoji: { postId, userId: actor.userId, emoji } },
                select: { id: true },
            });
            if (!reaction) throw new ApiError(Messages.RESOURCE_NOT_FOUND('Reaction'), StatusCodes.NOT_FOUND);

            await prisma.groupPostReaction.delete({
                where: { postId_userId_emoji: { postId, userId: actor.userId, emoji } },
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.removePostReaction:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── List comments ─────────────────────────────────────────────────────────

    async listComments(
        postId: string,
        actorId: string | null,
    ): Promise<CommentPublic[]> {
        try {
            const post = await prisma.groupPost.findUnique({
                where: { id: postId },
                select: { groupId: true, isPublic: true, isDeleted: true },
            });
            if (!post || post.isDeleted) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Post'), StatusCodes.NOT_FOUND);
            }

            if (!post.isPublic) {
                if (!actorId) throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
                await requireActiveMember(post.groupId, actorId);
            }

            // Return top-level comments only; replies fetched via parentId
            return prisma.groupPostComment.findMany({
                where: { postId, parentId: null, isDeleted: false },
                select: commentSelect,
                orderBy: { createdAt: 'asc' },
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.listComments:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Get comment replies ───────────────────────────────────────────────────

    async listReplies(commentId: string, actorId: string | null): Promise<CommentPublic[]> {
        try {
            const { groupId } = await resolveCommentGroup(commentId);
            const post = await prisma.groupPostComment.findUnique({
                where: { id: commentId },
                select: { post: { select: { isPublic: true } } },
            });

            if (!post?.post.isPublic) {
                if (!actorId) throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
                await requireActiveMember(groupId, actorId);
            }

            return prisma.groupPostComment.findMany({
                where: { parentId: commentId, isDeleted: false },
                select: commentSelect,
                orderBy: { createdAt: 'asc' },
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.listReplies:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Create comment ────────────────────────────────────────────────────────

    async createComment(
        postId: string,
        dto: CreateCommentDTO,
        actor: TokenPayload,
    ): Promise<CommentPublic> {
        try {
            const post = await prisma.groupPost.findUnique({
                where: { id: postId },
                select: { groupId: true, isDeleted: true },
            });
            if (!post || post.isDeleted) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Post'), StatusCodes.NOT_FOUND);
            }

            await requireActiveMember(post.groupId, actor.userId);

            // If replying, verify parent belongs to same post
            if (dto.parent_id) {
                const parent = await prisma.groupPostComment.findUnique({
                    where: { id: dto.parent_id },
                    select: { postId: true, isDeleted: true },
                });
                if (!parent || parent.isDeleted || parent.postId !== postId) {
                    throw new ApiError('Parent comment not found on this post.', StatusCodes.NOT_FOUND);
                }
            }

            const comment = await prisma.groupPostComment.create({
                data: {
                    postId,
                    authorId: actor.userId,
                    parentId: dto.parent_id ?? null,
                    content: dto.content.trim(),
                },
                select: commentSelect,
            });

            AuditLogger.log(actor, LogActions.FEED_COMMENT_CREATE, ResourceTypes.FEED_COMMENT, comment.id, 1, { postId });
            return comment;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.createComment:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Update comment ────────────────────────────────────────────────────────

    async updateComment(commentId: string, dto: UpdateCommentDTO, actor: TokenPayload): Promise<CommentPublic> {
        try {
            const { authorId } = await resolveCommentGroup(commentId);

            if (authorId !== actor.userId) {
                throw new ApiError('You can only edit your own comments.', StatusCodes.FORBIDDEN);
            }

            const comment = await prisma.groupPostComment.update({
                where: { id: commentId },
                data: { content: dto.content.trim() },
                select: commentSelect,
            });

            AuditLogger.log(actor, LogActions.FEED_COMMENT_UPDATE, ResourceTypes.FEED_COMMENT, commentId, 1);
            return comment;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.updateComment:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Delete comment ────────────────────────────────────────────────────────

    async deleteComment(commentId: string, actor: TokenPayload): Promise<void> {
        try {
            const { groupId, authorId } = await resolveCommentGroup(commentId);

            if (authorId !== actor.userId) {
                await requireGroupAdmin(groupId, actor.userId);
            }

            await prisma.groupPostComment.update({
                where: { id: commentId },
                data: { isDeleted: true },
            });

            AuditLogger.log(actor, LogActions.FEED_COMMENT_DELETE, ResourceTypes.FEED_COMMENT, commentId, 1, { groupId });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.deleteComment:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Comment reactions ─────────────────────────────────────────────────────

    async addCommentReaction(commentId: string, emoji: string, actor: TokenPayload): Promise<void> {
        try {
            const { groupId } = await resolveCommentGroup(commentId);
            await requireActiveMember(groupId, actor.userId);

            const existing = await prisma.groupPostCommentReaction.findUnique({
                where: { commentId_userId_emoji: { commentId, userId: actor.userId, emoji } },
                select: { id: true },
            });
            if (existing) throw new ApiError('You already reacted with this emoji.', StatusCodes.CONFLICT);

            await prisma.groupPostCommentReaction.create({
                data: { commentId, userId: actor.userId, emoji },
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.addCommentReaction:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    async removeCommentReaction(commentId: string, emoji: string, actor: TokenPayload): Promise<void> {
        try {
            const reaction = await prisma.groupPostCommentReaction.findUnique({
                where: { commentId_userId_emoji: { commentId, userId: actor.userId, emoji } },
                select: { id: true },
            });
            if (!reaction) throw new ApiError(Messages.RESOURCE_NOT_FOUND('Reaction'), StatusCodes.NOT_FOUND);

            await prisma.groupPostCommentReaction.delete({
                where: { commentId_userId_emoji: { commentId, userId: actor.userId, emoji } },
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('FeedService.removeCommentReaction:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}

export const feedService = new FeedService();
