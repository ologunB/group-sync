import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authenticateVerified } from '../../shared/middleware/auth.middleware';
import { uploadImages } from '../../shared/middleware/upload.middleware';
import { validateRequest } from '../../shared/utils/validators';
import { feedController } from './feed.controller';
import {
    groupIdParam,
    postIdParam,
    commentIdParam,
    createPostValidator,
    updatePostValidator,
    listFeedValidator,
    createCommentValidator,
    updateCommentValidator,
    reactValidator,
} from './feed.validator';

const router = Router();

// Optional auth helper — populates req.user if token present, but doesn't require it
function optionalAuth(req: Request, res: Response, next: NextFunction): void {
    if (req.headers.authorization?.startsWith('Bearer ')) {
        authenticate(req as any, res, next);
    } else {
        next();
    }
}

// ── Group-scoped feed ─────────────────────────────────────────────────────────

router.get(
    '/groups/:id/feed',
    optionalAuth,
    validateRequest([...groupIdParam, ...listFeedValidator]),
    feedController.listFeed,
);

router.post(
    '/groups/:id/feed',
    authenticateVerified,
    uploadImages('media'),
    validateRequest([...groupIdParam, ...createPostValidator]),
    feedController.createPost,
);

// ── Post-scoped routes ────────────────────────────────────────────────────────

router.get(
    '/feed/posts/:postId',
    optionalAuth,
    validateRequest(postIdParam),
    feedController.getPost,
);

router.patch(
    '/feed/posts/:postId',
    authenticate,
    validateRequest([...postIdParam, ...updatePostValidator]),
    feedController.updatePost,
);

router.delete(
    '/feed/posts/:postId',
    authenticate,
    validateRequest(postIdParam),
    feedController.deletePost,
);

router.patch(
    '/feed/posts/:postId/pin',
    authenticate,
    validateRequest(postIdParam),
    feedController.togglePin,
);

router.patch(
    '/feed/posts/:postId/visibility',
    authenticate,
    validateRequest(postIdParam),
    feedController.toggleVisibility,
);

router.post(
    '/feed/posts/:postId/react',
    authenticate,
    validateRequest([...postIdParam, ...reactValidator]),
    feedController.addPostReaction,
);

router.delete(
    '/feed/posts/:postId/react',
    authenticate,
    validateRequest([...postIdParam, ...reactValidator]),
    feedController.removePostReaction,
);

// ── Comments ──────────────────────────────────────────────────────────────────

router.get(
    '/feed/posts/:postId/comments',
    optionalAuth,
    validateRequest(postIdParam),
    feedController.listComments,
);

router.post(
    '/feed/posts/:postId/comments',
    authenticate,
    validateRequest([...postIdParam, ...createCommentValidator]),
    feedController.createComment,
);

router.patch(
    '/feed/comments/:commentId',
    authenticate,
    validateRequest([...commentIdParam, ...updateCommentValidator]),
    feedController.updateComment,
);

router.delete(
    '/feed/comments/:commentId',
    authenticate,
    validateRequest(commentIdParam),
    feedController.deleteComment,
);

router.get(
    '/feed/comments/:commentId/replies',
    optionalAuth,
    validateRequest(commentIdParam),
    feedController.listReplies,
);

router.post(
    '/feed/comments/:commentId/react',
    authenticate,
    validateRequest([...commentIdParam, ...reactValidator]),
    feedController.addCommentReaction,
);

router.delete(
    '/feed/comments/:commentId/react',
    authenticate,
    validateRequest([...commentIdParam, ...reactValidator]),
    feedController.removeCommentReaction,
);

export default router;
