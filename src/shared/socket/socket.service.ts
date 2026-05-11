import { Server as SocketServer, Socket, Namespace } from 'socket.io';
import { Server as HttpServer } from 'http';
import { prisma } from '../../database/connection';
import { redis } from '../../database/connection';
import { EncryptionUtil } from '../utils/encryption';
import { asLogger } from '../utils/asLogger';
import { SocketEvents } from './socket.events';
import { config } from '../config/app.config';
import { TokenPayload } from '../types/common.types';

// Augment Socket with the authenticated user payload
interface AuthSocket extends Socket {
    user: TokenPayload;
}

const PRESENCE_TTL = 90; // seconds
const MSG_RATE_LIMIT = 10;
const MSG_RATE_WINDOW = 10; // seconds

// ─── Auth middleware ──────────────────────────────────────────────────────────

function socketAuthMiddleware(socket: Socket, next: (err?: Error) => void): void {
    try {
        // Accept token from handshake auth (socket.io-client) or query param (Postman / browsers)
        const token = (socket.handshake.auth?.token ?? socket.handshake.query?.token) as string | undefined;
        if (!token) return next(new Error('Missing auth token'));
        const payload = EncryptionUtil.verifyJWT(token);
        (socket as AuthSocket).user = payload;
        next();
    } catch {
        next(new Error('Invalid auth token'));
    }
}

// ─── Connection handler ───────────────────────────────────────────────────────

async function handleConnection(socket: AuthSocket, nsp: Namespace): Promise<void> {
    const { userId } = socket.user;

    // Every user has a personal room for DMs and targeted notifications
    socket.join(`user:${userId}`);
    asLogger.info(`Socket connected: user=${userId} socket=${socket.id}`);

    // ── Heartbeat / presence ──────────────────────────────────────────────────
    socket.on(SocketEvents.HEARTBEAT, async () => {
        await redis.set(`presence:${userId}`, '1', 'EX', PRESENCE_TTL);
    });

    // ── Join group room ───────────────────────────────────────────────────────
    socket.on(SocketEvents.JOIN_GROUP, async ({ group_id }: { group_id: string }) => {
        try {
            const membership = await prisma.membership.findUnique({
                where: { userId_groupId: { userId, groupId: group_id } },
                select: { status: true },
            });
            if (!membership || membership.status !== 'active') {
                socket.emit(SocketEvents.ERROR, { message: 'Not an active member of this group.' });
                return;
            }
            socket.join(`group:${group_id}`);
        } catch (err) {
            asLogger.error('socket join_group error:', err);
        }
    });

    // ── Leave group room ──────────────────────────────────────────────────────
    socket.on(SocketEvents.LEAVE_GROUP, ({ group_id }: { group_id: string }) => {
        socket.leave(`group:${group_id}`);
    });

    // ── Send group message ────────────────────────────────────────────────────
    socket.on(SocketEvents.SEND_MESSAGE, async (payload: {
        group_id: string;
        content?: string;
        message_type?: string;
        reply_to_id?: string;
    }) => {
        try {
            const { group_id, content, message_type = 'text', reply_to_id } = payload;

            if (!content?.trim() && message_type === 'text') {
                socket.emit(SocketEvents.ERROR, { message: 'Message content is required.' });
                return;
            }

            // Rate limit: 10 messages per 10 seconds per user per group
            const rateKey = `msg:rate:${userId}:${group_id}`;
            const count = await redis.incr(rateKey);
            if (count === 1) await redis.expire(rateKey, MSG_RATE_WINDOW);
            if (count > MSG_RATE_LIMIT) {
                socket.emit(SocketEvents.ERROR, { message: 'Slow down. Too many messages.' });
                return;
            }

            // Verify membership + group state
            const [membership, group] = await Promise.all([
                prisma.membership.findUnique({
                    where: { userId_groupId: { userId, groupId: group_id } },
                    select: { status: true, role: true },
                }),
                prisma.group.findUnique({
                    where: { id: group_id },
                    select: { isChatLocked: true, status: true },
                }),
            ]);

            if (!membership || membership.status !== 'active') {
                socket.emit(SocketEvents.ERROR, { message: 'Not an active member of this group.' });
                return;
            }
            if (!group || group.status !== 'active') {
                socket.emit(SocketEvents.ERROR, { message: 'Group not found.' });
                return;
            }
            if (group.isChatLocked && !['super_admin', 'admin'].includes(membership.role)) {
                socket.emit(SocketEvents.ERROR, { message: 'Chat is locked. Only admins can send messages.' });
                return;
            }

            const message = await prisma.message.create({
                data: {
                    groupId: group_id,
                    senderId: userId,
                    content: content?.trim() ?? null,
                    messageType: message_type,
                    replyToId: reply_to_id ?? null,
                },
                select: {
                    id: true, groupId: true, senderId: true, content: true,
                    messageType: true, mediaUrl: true, replyToId: true,
                    isPinned: true, isDeleted: true, createdAt: true,
                    sender: { select: { id: true, displayName: true, profilePhotoUrl: true } },
                },
            });

            nsp.to(`group:${group_id}`).emit(SocketEvents.NEW_MESSAGE, { message });
        } catch (err) {
            asLogger.error('socket send_message error:', err);
            socket.emit(SocketEvents.ERROR, { message: 'Failed to send message.' });
        }
    });

    // ── Typing indicator ──────────────────────────────────────────────────────
    socket.on(SocketEvents.USER_TYPING, async ({ group_id }: { group_id: string }) => {
        try {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { displayName: true },
            });
            socket.to(`group:${group_id}`).emit(SocketEvents.TYPING, {
                group_id,
                user_id: userId,
                display_name: user?.displayName ?? '',
            });
        } catch { /* non-critical */ }
    });

    // ── DM via socket ─────────────────────────────────────────────────────────
    socket.on(SocketEvents.DM_SEND, async ({ receiver_id, content }: {
        receiver_id: string;
        content: string;
    }) => {
        try {
            if (!content?.trim()) {
                socket.emit(SocketEvents.ERROR, { message: 'Content is required.' });
                return;
            }

            // Shared group check
            const shared = await prisma.$queryRaw<{ exists: boolean }[]>`
                SELECT EXISTS (
                    SELECT 1 FROM memberships m1
                    JOIN memberships m2 ON m1.group_id = m2.group_id
                    WHERE m1.user_id = ${userId}::uuid AND m2.user_id = ${receiver_id}::uuid
                      AND m1.status = 'active' AND m2.status = 'active'
                ) as exists
            `;
            if (!shared[0]?.exists) {
                socket.emit(SocketEvents.ERROR, { message: 'You can only DM users who share a group with you.' });
                return;
            }

            // Block check
            const blocked = await prisma.userBlock.findFirst({
                where: {
                    OR: [
                        { blockerId: userId, blockedId: receiver_id },
                        { blockerId: receiver_id, blockedId: userId },
                    ],
                },
                select: { id: true },
            });
            if (blocked) {
                socket.emit(SocketEvents.ERROR, { message: 'Cannot send DM to this user.' });
                return;
            }

            const dm = await prisma.directMessage.create({
                data: { senderId: userId, receiverId: receiver_id, content: content.trim() },
                select: {
                    id: true, senderId: true, receiverId: true, content: true,
                    isRead: true, createdAt: true,
                    sender: { select: { id: true, displayName: true, profilePhotoUrl: true } },
                },
            });

            // Emit to receiver's personal room
            nsp.to(`user:${receiver_id}`).emit(SocketEvents.DM_RECEIVED, { message: dm });
            // Echo back to sender (in case they have multiple devices)
            socket.emit(SocketEvents.DM_RECEIVED, { message: dm });
        } catch (err) {
            asLogger.error('socket dm_send error:', err);
            socket.emit(SocketEvents.ERROR, { message: 'Failed to send DM.' });
        }
    });

    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
        await redis.del(`presence:${userId}`);
        nsp.emit(SocketEvents.PRESENCE_UPDATE, { user_id: userId, status: 'offline' });
        asLogger.info(`Socket disconnected: user=${userId}`);
    });
}

// ─── SocketService ────────────────────────────────────────────────────────────

export class SocketService {
    private static io: SocketServer | null = null;
    private static chatNsp: Namespace | null = null;

    static attach(httpServer: HttpServer): void {
        SocketService.io = new SocketServer(httpServer, {
            cors: {
                origin: config.server.corsOrigins,
                credentials: true,
            },
            transports: ['websocket', 'polling'],
        });

        SocketService.chatNsp = SocketService.io.of('/chat');
        SocketService.chatNsp.use(socketAuthMiddleware);
        SocketService.chatNsp.on('connection', (socket) =>
            handleConnection(socket as AuthSocket, SocketService.chatNsp!),
        );

        asLogger.info('Socket.io attached on namespace /chat');
    }

    // Broadcast to a room (group or personal)
    static emitToRoom(room: string, event: string, data: unknown): void {
        SocketService.chatNsp?.to(room).emit(event, data);
    }

    // Force a user out of a group room (called when kicked/removed)
    static kickFromRoom(userId: string, groupId: string): void {
        SocketService.chatNsp?.in(`user:${userId}`).socketsLeave(`group:${groupId}`);
        SocketService.chatNsp?.to(`user:${userId}`).emit(SocketEvents.KICKED_FROM_GROUP, { group_id: groupId });
    }

    static get isReady(): boolean {
        return SocketService.chatNsp !== null;
    }
}
