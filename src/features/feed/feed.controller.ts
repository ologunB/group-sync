import { Request, Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AuthenticatedRequest } from '../../shared/middleware/auth.middleware';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { feedService } from './feed.service';
import { CreatePostDTO, UpdatePostDTO, ListFeedQuery, CreateCommentDTO, UpdateCommentDTO, UploadedPostMedia } from './feed.types';

export class FeedController {

    // ── Feed listing ──────────────────────────────────────────────────────────

    listFeed = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const actorId = (req as AuthenticatedRequest).user?.userId ?? null;
            const query: ListFeedQuery = {
                cursor: req.query.cursor as string | undefined,
                limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
            };
            const result = await feedService.listFeed(req.params.id, query, actorId);
            ResponseHelper.success(res, result, 'Feed retrieved.');
        } catch (error) { next(error); }
    };

    getPost = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const actorId = (req as AuthenticatedRequest).user?.userId ?? null;
            const post = await feedService.getPost(req.params.postId, actorId);
            ResponseHelper.success(res, post, 'Post retrieved.');
        } catch (error) { next(error); }
    };

    // ── Post mutations ────────────────────────────────────────────────────────

    createPost = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const files: UploadedPostMedia[] = ((req as any).files as Express.Multer.File[] ?? [])
                .map((f) => ({ buffer: f.buffer, mimeType: f.mimetype }));
            const post = await feedService.createPost(req.params.id, req.body as CreatePostDTO, req.user!, files);
            ResponseHelper.success(res, post, 'Post created.', StatusCodes.CREATED);
        } catch (error) { next(error); }
    };

    updatePost = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const post = await feedService.updatePost(req.params.postId, req.body as UpdatePostDTO, req.user!);
            ResponseHelper.success(res, post, 'Post updated.');
        } catch (error) { next(error); }
    };

    deletePost = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await feedService.deletePost(req.params.postId, req.user!);
            ResponseHelper.success(res, null, 'Post deleted.');
        } catch (error) { next(error); }
    };

    togglePin = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const post = await feedService.togglePin(req.params.postId, req.user!);
            ResponseHelper.success(res, post, `Post ${post.isPinned ? 'pinned' : 'unpinned'}.`);
        } catch (error) { next(error); }
    };

    toggleVisibility = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const post = await feedService.toggleVisibility(req.params.postId, req.user!);
            ResponseHelper.success(res, post, `Post is now ${post.isPublic ? 'public' : 'private'}.`);
        } catch (error) { next(error); }
    };

    // ── Post reactions ────────────────────────────────────────────────────────

    addPostReaction = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await feedService.addPostReaction(req.params.postId, req.body.emoji, req.user!);
            ResponseHelper.success(res, null, 'Reaction added.', StatusCodes.CREATED);
        } catch (error) { next(error); }
    };

    removePostReaction = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await feedService.removePostReaction(req.params.postId, req.body.emoji, req.user!);
            ResponseHelper.success(res, null, 'Reaction removed.');
        } catch (error) { next(error); }
    };

    // ── Comments ──────────────────────────────────────────────────────────────

    listComments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const actorId = (req as AuthenticatedRequest).user?.userId ?? null;
            const comments = await feedService.listComments(req.params.postId, actorId);
            ResponseHelper.success(res, comments, 'Comments retrieved.');
        } catch (error) { next(error); }
    };

    listReplies = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const actorId = (req as AuthenticatedRequest).user?.userId ?? null;
            const replies = await feedService.listReplies(req.params.commentId, actorId);
            ResponseHelper.success(res, replies, 'Replies retrieved.');
        } catch (error) { next(error); }
    };

    createComment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const comment = await feedService.createComment(req.params.postId, req.body as CreateCommentDTO, req.user!);
            ResponseHelper.success(res, comment, 'Comment added.', StatusCodes.CREATED);
        } catch (error) { next(error); }
    };

    updateComment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const comment = await feedService.updateComment(req.params.commentId, req.body as UpdateCommentDTO, req.user!);
            ResponseHelper.success(res, comment, 'Comment updated.');
        } catch (error) { next(error); }
    };

    deleteComment = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await feedService.deleteComment(req.params.commentId, req.user!);
            ResponseHelper.success(res, null, 'Comment deleted.');
        } catch (error) { next(error); }
    };

    // ── Comment reactions ─────────────────────────────────────────────────────

    addCommentReaction = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await feedService.addCommentReaction(req.params.commentId, req.body.emoji, req.user!);
            ResponseHelper.success(res, null, 'Reaction added.', StatusCodes.CREATED);
        } catch (error) { next(error); }
    };

    removeCommentReaction = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            await feedService.removeCommentReaction(req.params.commentId, req.body.emoji, req.user!);
            ResponseHelper.success(res, null, 'Reaction removed.');
        } catch (error) { next(error); }
    };
}

export const feedController = new FeedController();
