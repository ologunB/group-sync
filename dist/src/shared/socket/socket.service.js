"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SocketService = void 0;
const socket_io_1 = require("socket.io");
const connection_1 = require("../../database/connection");
const connection_2 = require("../../database/connection");
const encryption_1 = require("../utils/encryption");
const asLogger_1 = require("../utils/asLogger");
const socket_events_1 = require("./socket.events");
const app_config_1 = require("../config/app.config");
const message_types_1 = require("../../features/messages/message.types");
const PRESENCE_TTL = 90; // seconds
const MSG_RATE_LIMIT = 10;
const MSG_RATE_WINDOW = 10; // seconds
// ─── Auth middleware ──────────────────────────────────────────────────────────
function socketAuthMiddleware(socket, next) {
    try {
        // Accept token from handshake auth (socket.io-client) or query param (Postman / browsers)
        const token = (socket.handshake.auth?.token ?? socket.handshake.query?.token);
        if (!token)
            return next(new Error('Missing auth token'));
        const payload = encryption_1.EncryptionUtil.verifyJWT(token);
        socket.user = payload;
        next();
    }
    catch {
        next(new Error('Invalid auth token'));
    }
}
// ─── Connection handler ───────────────────────────────────────────────────────
async function handleConnection(socket, nsp) {
    const { userId } = socket.user;
    // Every user has a personal room for DMs and targeted notifications
    socket.join(`user:${userId}`);
    asLogger_1.asLogger.info(`Socket connected: user=${userId} socket=${socket.id}`);
    // ── Heartbeat / presence ──────────────────────────────────────────────────
    socket.on(socket_events_1.SocketEvents.HEARTBEAT, async () => {
        await connection_2.redis.set(`presence:${userId}`, '1', 'EX', PRESENCE_TTL);
    });
    // ── Join group room ───────────────────────────────────────────────────────
    socket.on(socket_events_1.SocketEvents.JOIN_GROUP, async ({ group_id }) => {
        try {
            const membership = await connection_1.prisma.membership.findUnique({
                where: { userId_groupId: { userId, groupId: group_id } },
                select: { status: true },
            });
            if (!membership || membership.status !== 'active') {
                socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Not an active member of this group.' });
                return;
            }
            socket.join(`group:${group_id}`);
            socket.emit(socket_events_1.SocketEvents.GROUP_JOINED, { group_id });
        }
        catch (err) {
            asLogger_1.asLogger.error('socket join_group error:', err);
            socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Failed to join group.' });
        }
    });
    // ── Leave group room ──────────────────────────────────────────────────────
    socket.on(socket_events_1.SocketEvents.LEAVE_GROUP, ({ group_id }) => {
        socket.leave(`group:${group_id}`);
    });
    // ── Send group message ────────────────────────────────────────────────────
    socket.on(socket_events_1.SocketEvents.SEND_MESSAGE, async (payload) => {
        try {
            const { group_id, content, message_type = 'text', reply_to_id } = payload;
            if (!content?.trim() && message_type === 'text') {
                socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Message content is required.' });
                return;
            }
            // Rate limit: 10 messages per 10 seconds per user per group
            const rateKey = `msg:rate:${userId}:${group_id}`;
            const count = await connection_2.redis.incr(rateKey);
            if (count === 1)
                await connection_2.redis.expire(rateKey, MSG_RATE_WINDOW);
            if (count > MSG_RATE_LIMIT) {
                socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Slow down. Too many messages.' });
                return;
            }
            // Verify membership + group state
            const [membership, group] = await Promise.all([
                connection_1.prisma.membership.findUnique({
                    where: { userId_groupId: { userId, groupId: group_id } },
                    select: { status: true, role: true },
                }),
                connection_1.prisma.group.findUnique({
                    where: { id: group_id },
                    select: { isChatLocked: true, status: true },
                }),
            ]);
            if (!membership || membership.status !== 'active') {
                socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Not an active member of this group.' });
                return;
            }
            if (!group || group.status !== 'active') {
                socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Group not found.' });
                return;
            }
            if (group.isChatLocked && !['super_admin', 'admin'].includes(membership.role)) {
                socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Chat is locked. Only admins can send messages.' });
                return;
            }
            const message = await connection_1.prisma.message.create({
                data: {
                    groupId: group_id,
                    senderId: userId,
                    content: content?.trim() ?? null,
                    messageType: message_type,
                    replyToId: reply_to_id ?? null,
                },
                select: message_types_1.messageSelect,
            });
            nsp.to(`group:${group_id}`).emit(socket_events_1.SocketEvents.NEW_MESSAGE, { message });
        }
        catch (err) {
            asLogger_1.asLogger.error('socket send_message error:', err);
            socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Failed to send message.' });
        }
    });
    // ── Typing indicator ──────────────────────────────────────────────────────
    socket.on(socket_events_1.SocketEvents.USER_TYPING, async ({ group_id }) => {
        try {
            const user = await connection_1.prisma.user.findUnique({
                where: { id: userId },
                select: { displayName: true },
            });
            socket.to(`group:${group_id}`).emit(socket_events_1.SocketEvents.TYPING, {
                group_id,
                user_id: userId,
                display_name: user?.displayName ?? '',
            });
        }
        catch { /* non-critical */ }
    });
    // ── DM via socket ─────────────────────────────────────────────────────────
    socket.on(socket_events_1.SocketEvents.DM_SEND, async ({ receiver_id, content }) => {
        try {
            if (!content?.trim()) {
                socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Content is required.' });
                return;
            }
            // Shared group check
            const shared = await connection_1.prisma.$queryRaw `
                SELECT EXISTS (
                    SELECT 1 FROM memberships m1
                    JOIN memberships m2 ON m1.group_id = m2.group_id
                    WHERE m1.user_id = ${userId}::uuid AND m2.user_id = ${receiver_id}::uuid
                      AND m1.status = 'active' AND m2.status = 'active'
                ) as exists
            `;
            if (!shared[0]?.exists) {
                socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'You can only DM users who share a group with you.' });
                return;
            }
            // Block check
            const blocked = await connection_1.prisma.userBlock.findFirst({
                where: {
                    OR: [
                        { blockerId: userId, blockedId: receiver_id },
                        { blockerId: receiver_id, blockedId: userId },
                    ],
                },
                select: { id: true },
            });
            if (blocked) {
                socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Cannot send DM to this user.' });
                return;
            }
            const dm = await connection_1.prisma.directMessage.create({
                data: { senderId: userId, receiverId: receiver_id, content: content.trim() },
                select: {
                    id: true, senderId: true, receiverId: true, content: true,
                    isRead: true, createdAt: true,
                    sender: { select: { id: true, displayName: true, profilePhotoUrl: true } },
                },
            });
            // Emit to receiver's personal room
            nsp.to(`user:${receiver_id}`).emit(socket_events_1.SocketEvents.DM_RECEIVED, { message: dm });
            // Echo back to sender (in case they have multiple devices)
            socket.emit(socket_events_1.SocketEvents.DM_RECEIVED, { message: dm });
        }
        catch (err) {
            asLogger_1.asLogger.error('socket dm_send error:', err);
            socket.emit(socket_events_1.SocketEvents.ERROR, { message: 'Failed to send DM.' });
        }
    });
    // ── DM typing indicator ───────────────────────────────────────────────────
    socket.on(socket_events_1.SocketEvents.DM_TYPING, ({ receiver_id }) => {
        nsp.to(`user:${receiver_id}`).emit(socket_events_1.SocketEvents.DM_TYPING_UPDATE, {
            sender_id: userId,
        });
    });
    // ── Disconnect ────────────────────────────────────────────────────────────
    socket.on('disconnect', async () => {
        await connection_2.redis.del(`presence:${userId}`);
        nsp.emit(socket_events_1.SocketEvents.PRESENCE_UPDATE, { user_id: userId, status: 'offline' });
        asLogger_1.asLogger.info(`Socket disconnected: user=${userId}`);
    });
}
// ─── SocketService ────────────────────────────────────────────────────────────
class SocketService {
    static io = null;
    static chatNsp = null;
    static attach(httpServer) {
        SocketService.io = new socket_io_1.Server(httpServer, {
            cors: {
                origin: app_config_1.config.server.corsOrigins,
                credentials: true,
            },
            transports: ['websocket', 'polling'],
        });
        SocketService.chatNsp = SocketService.io.of('/chat');
        SocketService.chatNsp.use(socketAuthMiddleware);
        SocketService.chatNsp.on('connection', (socket) => handleConnection(socket, SocketService.chatNsp));
        asLogger_1.asLogger.info('Socket.io attached on namespace /chat');
    }
    // Broadcast to a room (group or personal)
    static emitToRoom(room, event, data) {
        SocketService.chatNsp?.to(room).emit(event, data);
    }
    // Force a user out of a group room (called when kicked/removed)
    static kickFromRoom(userId, groupId) {
        SocketService.chatNsp?.in(`user:${userId}`).socketsLeave(`group:${groupId}`);
        SocketService.chatNsp?.to(`user:${userId}`).emit(socket_events_1.SocketEvents.KICKED_FROM_GROUP, { group_id: groupId });
    }
    static get isReady() {
        return SocketService.chatNsp !== null;
    }
}
exports.SocketService = SocketService;
//# sourceMappingURL=socket.service.js.map