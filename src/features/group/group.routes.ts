import { Router } from 'express';
import { GroupController } from './group.controller';
import {
    authenticate,
    authenticateVerified,
    authorizeGroupRole,
} from '../../shared/middleware/auth.middleware';
import { validateRequest } from '../../shared/utils/validators';
import { uploadImage } from '../../shared/middleware/upload.middleware';
import {
    createGroupValidator,
    updateGroupValidator,
    listGroupsValidator,
    groupIdParamValidator,
    groupSlugParamValidator,
    memberSearchValidator,
} from './group.validator';
import { Request, Response, NextFunction } from 'express';

const router = Router();
const controller = new GroupController();

// ─── POST /groups — verified users only ───────────────────────────────────────
router.post(
    '/',
    authenticateVerified,
    validateRequest(createGroupValidator),
    controller.createGroup,
);

// ─── GET /groups — public, optional auth (affects invite-only visibility) ─────
router.get(
    '/',
    (req: Request, _res: Response, next: NextFunction): void => {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            authenticate(req as any, _res, next);
            return;
        }
        next();
    },
    validateRequest(listGroupsValidator),
    controller.listGroups,
);

// ─── GET /groups/:slug — public, optional auth ────────────────────────────────
router.get(
    '/:slug',
    (req: Request, _res: Response, next: NextFunction): void => {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            authenticate(req as any, _res, next);
            return;
        }
        next();
    },
    validateRequest(groupSlugParamValidator),
    controller.getGroupBySlug,
);

// ─── PATCH /groups/:id — admin or super_admin ─────────────────────────────────
router.patch(
    '/:id',
    authenticate,
    validateRequest(groupIdParamValidator),
    authorizeGroupRole('super_admin', 'admin'),
    validateRequest(updateGroupValidator),
    controller.updateGroup,
);

// ─── DELETE /groups/:id — super_admin only ────────────────────────────────────
router.delete(
    '/:id',
    authenticate,
    validateRequest(groupIdParamValidator),
    authorizeGroupRole('super_admin'),
    controller.deleteGroup,
);

// ─── GET /groups/:id/members — active members only ───────────────────────────
router.get(
    '/:id/members',
    authenticate,
    validateRequest(memberSearchValidator),
    authorizeGroupRole('super_admin', 'admin', 'moderator', 'member'),
    controller.getGroupMembers,
);

// ─── GET /groups/:id/stats — admin only ──────────────────────────────────────
router.get(
    '/:id/stats',
    authenticate,
    validateRequest(groupIdParamValidator),
    authorizeGroupRole('super_admin', 'admin'),
    controller.getGroupStats,
);

// ─── POST /groups/:id/cover — admin or super_admin ───────────────────────────
router.post(
    '/:id/cover',
    authenticate,
    validateRequest(groupIdParamValidator),
    authorizeGroupRole('super_admin', 'admin'),
    uploadImage('cover'),
    controller.uploadCover,
);

// ─── POST /groups/:id/logo — admin or super_admin ────────────────────────────
router.post(
    '/:id/logo',
    authenticate,
    validateRequest(groupIdParamValidator),
    authorizeGroupRole('super_admin', 'admin'),
    uploadImage('logo'),
    controller.uploadLogo,
);

export default router;
