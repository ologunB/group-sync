import { Router } from 'express';
import { UserController } from './user.controller';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { validateRequest } from '../../shared/utils/validators';
import {
    updateProfileValidator,
    updateInterestsValidator,
    userIdParamValidator,
    paginationValidator,
    myApplicationsValidator,
} from './user.validator';

const router = Router();
const controller = new UserController();

// ─── /users/me routes — all require authentication ────────────────────────────

router.get('/me', authenticate, controller.getMe);
router.patch('/me', authenticate, validateRequest(updateProfileValidator), controller.updateMe);
router.delete('/me', authenticate, controller.deleteMe);
router.get('/me/groups', authenticate, validateRequest(paginationValidator), controller.getMyGroups);
router.get('/me/applications', authenticate, validateRequest(myApplicationsValidator), controller.getMyApplications);
router.post('/me/interests', authenticate, validateRequest(updateInterestsValidator), controller.updateInterests);

// ─── /users/:id routes — auth required, public profile ───────────────────────

router.get('/:id', authenticate, validateRequest(userIdParamValidator), controller.getUserById);
router.post('/:id/block', authenticate, validateRequest(userIdParamValidator), controller.blockUser);
router.delete('/:id/block', authenticate, validateRequest(userIdParamValidator), controller.unblockUser);

export default router;
