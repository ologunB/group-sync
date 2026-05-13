import { Router } from 'express';
import { authenticate, authenticateVerified } from '../../shared/middleware/auth.middleware';
import { uploadImage } from '../../shared/middleware/upload.middleware';
import { validateRequest } from '../../shared/utils/validators';
import { messageController } from './message.controller';
import {
    sendMessageValidator,
    listMessagesValidator,
    toggleChatLockValidator,
} from './message.validator';

const router = Router();

// ── Group-scoped routes (/groups/:id/...) ─────────────────────────────────────

// Pinned messages before /:messageId routes to avoid param collision
router.get('/groups/:id/messages/pinned',
    authenticate,
    messageController.listPinned,
);

router.get('/groups/:id/messages',
    authenticate,
    validateRequest(listMessagesValidator),
    messageController.listMessages,
);

router.post('/groups/:id/messages',
    authenticateVerified,
    uploadImage('media'),
    validateRequest(sendMessageValidator),
    messageController.sendMessage,
);

// Toggle group chat lock — admin only (enforced inside service)
router.patch('/groups/:id/chat',
    authenticate,
    validateRequest(toggleChatLockValidator),
    messageController.toggleChatLock,
);

// ── Message-scoped routes (/messages/:id/...) ─────────────────────────────────

router.delete('/messages/:id',
    authenticate,
    messageController.deleteMessage,
);

router.patch('/messages/:id/pin',
    authenticate,
    messageController.togglePin,
);

router.post('/messages/:id/react',
    authenticate,
    validateRequest([
        require('express-validator').body('emoji')
            .exists().withMessage('emoji is required')
            .isString().isLength({ min: 1, max: 10 }).withMessage('Invalid emoji'),
    ]),
    messageController.addReaction,
);

router.delete('/messages/:id/react',
    authenticate,
    validateRequest([
        require('express-validator').body('emoji')
            .exists().withMessage('emoji is required')
            .isString().isLength({ min: 1, max: 10 }).withMessage('Invalid emoji'),
    ]),
    messageController.removeReaction,
);

export default router;
