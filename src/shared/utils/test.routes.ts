import { Router, Request, Response } from 'express';
import { redis, prisma } from '../../database/connection';
import { ResponseHelper } from '../utils/response.helper';

// These routes are ONLY mounted in non-production environments.
// They expose internal state (Redis OTPs, DB writes) so the integration test
// suite can run without requiring direct Redis/Prisma imports on the test runner.

const router = Router();

// GET /test/otp?email=X&type=verify_email|forgot_password
router.get('/otp', async (req: Request, res: Response) => {
    const { email, type } = req.query as { email?: string; type?: string };
    if (!email) {
        ResponseHelper.error(res, 'email query param required', 400);
        return;
    }
    const prefix = type === 'forgot_password' ? 'verify:forgot' : 'verify:email';
    const key = `${prefix}:${email}`;
    const otp = await redis.get(key);
    if (!otp) {
        ResponseHelper.error(res, `OTP not found for ${email}`, 404);
        return;
    }
    ResponseHelper.success(res, { otp });
});

// PATCH /test/verify-user/:userId
router.patch('/verify-user/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    await prisma.user.update({
        where: { id: userId },
        data:  { idVerificationStatus: 'verified' },
    });
    ResponseHelper.success(res, { userId });
});

// POST /test/seed-notification
router.post('/seed-notification', async (req: Request, res: Response) => {
    const { userId, type = 'system', title, body } = req.body as {
        userId: string; type?: string; title: string; body: string;
    };
    if (!userId || !title || !body) {
        ResponseHelper.error(res, 'userId, title, body are required', 400);
        return;
    }
    const notif = await prisma.notification.create({
        data: { userId, type, title, body },
    });
    ResponseHelper.success(res, { id: notif.id }, 'Notification seeded', 201);
});

// GET /test/presence/:userId
router.get('/presence/:userId', async (req: Request, res: Response) => {
    const { userId } = req.params;
    const value = await redis.get(`presence:${userId}`);
    ResponseHelper.success(res, { present: value !== null, value });
});

export default router;
