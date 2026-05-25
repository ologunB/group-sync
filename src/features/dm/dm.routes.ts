import { Router } from 'express';
import { authenticate, authenticateVerified } from '../../shared/middleware/auth.middleware';
import { uploadImage } from '../../shared/middleware/upload.middleware';
import { validateRequest } from '../../shared/utils/validators';
import { dmController } from './dm.controller';
import { sendDmValidator, listThreadValidator, listConversationsValidator, dmReactionValidator } from './dm.validator';

const router = Router();

// Unified conversation inbox (groups + DMs)
router.get('/conversations', authenticate, validateRequest(listConversationsValidator), dmController.listConversations);

// DM thread with a specific user
router.get('/dm/:userId', authenticate, validateRequest(listThreadValidator), dmController.getThread);

// Send DM
router.post('/dm/:userId', authenticateVerified, uploadImage('media'), validateRequest(sendDmValidator), dmController.sendDm);

// Mark thread as read
router.patch('/dm/:userId/read', authenticate, dmController.markRead);

// Delete a single DM (soft, per-side)
router.delete('/dm/:dmId', authenticate, dmController.deleteDm);

// Reactions on a DM
router.post('/dm/:dmId/react', authenticate, validateRequest(dmReactionValidator), dmController.addReaction);
router.delete('/dm/:dmId/react', authenticate, validateRequest(dmReactionValidator), dmController.removeReaction);

export default router;
