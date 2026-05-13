"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dmService = exports.DmService = void 0;
const http_status_codes_1 = require("http-status-codes");
const crypto_1 = require("crypto");
const connection_1 = require("../../database/connection");
const error_middleware_1 = require("../../shared/middleware/error.middleware");
const response_constants_1 = require("../../shared/utils/response.constants");
const asLogger_1 = require("../../shared/utils/asLogger");
const audit_logger_1 = require("../../shared/utils/audit.logger");
const socket_service_1 = require("../../shared/socket/socket.service");
const socket_events_1 = require("../../shared/socket/socket.events");
const storage_service_1 = require("../../shared/storage/storage.service");
const notification_service_1 = require("../notifications/notification.service");
const dm_types_1 = require("./dm.types");
class DmService {
    // ── Unified conversation list ─────────────────────────────────────────────
    async listConversations(actor) {
        try {
            const userId = actor.userId;
            // ── Group conversations ───────────────────────────────────────────
            const memberships = await connection_1.prisma.membership.findMany({
                where: { userId, status: 'active' },
                select: {
                    group: {
                        select: {
                            id: true,
                            name: true,
                            logoUrl: true,
                            isChatLocked: true,
                            messages: {
                                where: { isDeleted: false },
                                orderBy: { createdAt: 'desc' },
                                take: 1,
                                select: {
                                    id: true, content: true, isDeleted: true, createdAt: true,
                                    sender: { select: { displayName: true } },
                                },
                            },
                            chatReadReceipts: {
                                where: { userId },
                                select: { lastReadAt: true },
                            },
                        },
                    },
                },
            });
            // Count unread per group in one batch query
            const groupIds = memberships.map((m) => m.group.id);
            const unreadCounts = groupIds.length > 0
                ? await connection_1.prisma.$queryRaw `
                    SELECT mem.group_id, COUNT(msg.id)::bigint as count
                    FROM memberships mem
                    JOIN messages msg ON msg.group_id = mem.group_id
                    LEFT JOIN chat_read_receipts crt
                        ON crt.user_id = ${userId}::uuid AND crt.group_id = mem.group_id
                    WHERE mem.user_id = ${userId}::uuid
                      AND mem.status = 'active'
                      AND msg.is_deleted = FALSE
                      AND msg.sender_id != ${userId}::uuid
                      AND msg.created_at > COALESCE(crt.last_read_at, '1970-01-01'::timestamptz)
                      AND mem.group_id = ANY(${groupIds}::uuid[])
                    GROUP BY mem.group_id
                `
                : [];
            const unreadMap = new Map(unreadCounts.map((r) => [r.group_id, Number(r.count)]));
            const groupConversations = memberships.map((m) => {
                const lastMsg = m.group.messages[0] ?? null;
                return {
                    type: 'group',
                    id: m.group.id,
                    name: m.group.name,
                    avatar: m.group.logoUrl,
                    is_chat_locked: m.group.isChatLocked,
                    last_message: lastMsg ? {
                        id: lastMsg.id,
                        content: lastMsg.isDeleted ? null : lastMsg.content,
                        sender_name: lastMsg.sender?.displayName ?? null,
                        created_at: lastMsg.createdAt,
                        is_deleted: lastMsg.isDeleted,
                    } : null,
                    unread_count: unreadMap.get(m.group.id) ?? 0,
                };
            });
            // ── DM conversations ──────────────────────────────────────────────
            // Get the latest message per unique conversation partner
            const dmRows = await connection_1.prisma.$queryRaw `
                SELECT
                    other_user.id              AS other_user_id,
                    other_user.display_name    AS other_display_name,
                    other_user.profile_photo_url AS other_photo,
                    latest.id                  AS dm_id,
                    latest.content             AS dm_content,
                    latest.created_at          AS dm_created_at,
                    (
                        SELECT COUNT(*)::bigint
                        FROM direct_messages unread_dm
                        WHERE unread_dm.sender_id = other_user.id
                          AND unread_dm.receiver_id = ${userId}::uuid
                          AND unread_dm.is_read = FALSE
                          AND unread_dm.is_deleted_by_receiver = FALSE
                    ) AS unread
                FROM (
                    SELECT DISTINCT ON (
                        LEAST(sender_id::text, receiver_id::text),
                        GREATEST(sender_id::text, receiver_id::text)
                    )
                        id, sender_id, receiver_id, content, created_at,
                        is_deleted_by_sender, is_deleted_by_receiver
                    FROM direct_messages
                    WHERE (sender_id = ${userId}::uuid AND is_deleted_by_sender = FALSE)
                       OR (receiver_id = ${userId}::uuid AND is_deleted_by_receiver = FALSE)
                    ORDER BY
                        LEAST(sender_id::text, receiver_id::text),
                        GREATEST(sender_id::text, receiver_id::text),
                        created_at DESC
                ) latest
                JOIN users other_user
                    ON other_user.id = CASE
                        WHEN latest.sender_id = ${userId}::uuid THEN latest.receiver_id
                        ELSE latest.sender_id
                    END
                ORDER BY latest.created_at DESC
            `;
            const dmConversations = dmRows.map((row) => ({
                type: 'dm',
                id: row.other_user_id,
                name: row.other_display_name,
                avatar: row.other_photo,
                last_message: {
                    id: row.dm_id,
                    content: row.dm_content,
                    sender_name: row.other_display_name,
                    created_at: row.dm_created_at,
                },
                unread_count: Number(row.unread),
            }));
            // Merge and sort by last message timestamp (most recent first)
            const all = [...groupConversations, ...dmConversations];
            all.sort((a, b) => {
                const aTime = a.last_message?.created_at?.getTime() ?? 0;
                const bTime = b.last_message?.created_at?.getTime() ?? 0;
                return bTime - aTime;
            });
            return all;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('DmService.listConversations error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Get DM thread with a user ─────────────────────────────────────────────
    async getThread(otherUserId, query, actor) {
        try {
            const userId = actor.userId;
            const limit = Math.min(query.limit ?? 50, 100);
            const where = {
                OR: [
                    { senderId: userId, receiverId: otherUserId, isDeletedBySender: false },
                    { senderId: otherUserId, receiverId: userId, isDeletedByReceiver: false },
                ],
            };
            if (query.cursor) {
                const cursorRow = await connection_1.prisma.directMessage.findUnique({
                    where: { id: query.cursor },
                    select: { createdAt: true },
                });
                if (cursorRow)
                    where.createdAt = { lt: cursorRow.createdAt };
            }
            const data = await connection_1.prisma.directMessage.findMany({
                where,
                select: dm_types_1.dmSelect,
                orderBy: { createdAt: 'desc' },
                take: limit + 1,
            });
            const has_more = data.length > limit;
            if (has_more)
                data.pop();
            return { data, next_cursor: has_more ? data[data.length - 1].id : null, has_more };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('DmService.getThread error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Send DM ───────────────────────────────────────────────────────────────
    async sendDm(otherUserId, dto, actor, media) {
        try {
            const userId = actor.userId;
            if (userId === otherUserId) {
                throw new error_middleware_1.ApiError('Cannot send a DM to yourself.', http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
            }
            // Receiver must exist
            const receiver = await connection_1.prisma.user.findUnique({
                where: { id: otherUserId, deletedAt: null },
                select: { id: true, displayName: true },
            });
            if (!receiver) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('User'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Must share at least one active group
            const shared = await connection_1.prisma.$queryRaw `
                SELECT EXISTS (
                    SELECT 1 FROM memberships m1
                    JOIN memberships m2 ON m1.group_id = m2.group_id
                    WHERE m1.user_id = ${userId}::uuid AND m2.user_id = ${otherUserId}::uuid
                      AND m1.status = 'active' AND m2.status = 'active'
                ) as exists
            `;
            if (!shared[0]?.exists) {
                throw new error_middleware_1.ApiError('You can only DM users who share a group with you.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            // Block check (either direction)
            const blocked = await connection_1.prisma.userBlock.findFirst({
                where: {
                    OR: [
                        { blockerId: userId, blockedId: otherUserId },
                        { blockerId: otherUserId, blockedId: userId },
                    ],
                },
                select: { id: true },
            });
            if (blocked) {
                throw new error_middleware_1.ApiError('Cannot send DM to this user.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            let mediaUrl = dto.media_url ?? null;
            if (media) {
                const result = await storage_service_1.StorageService.upload(media.buffer, media.mimeType, {
                    folder: `groupsync/dms/${userId}`,
                    publicId: `${otherUserId}-${Date.now()}-${(0, crypto_1.randomUUID)()}`,
                    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
                });
                mediaUrl = result.url;
            }
            if (!dto.content?.trim() && !mediaUrl) {
                throw new error_middleware_1.ApiError('Content or media is required.', http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
            }
            const dm = await connection_1.prisma.directMessage.create({
                data: {
                    senderId: userId,
                    receiverId: otherUserId,
                    content: dto.content?.trim() ?? null,
                    mediaUrl,
                },
                select: dm_types_1.dmSelect,
            });
            // Real-time delivery
            socket_service_1.SocketService.emitToRoom(`user:${otherUserId}`, socket_events_1.SocketEvents.DM_RECEIVED, { message: dm });
            // In-app notification
            await notification_service_1.NotificationService.create({
                userId: otherUserId,
                type: 'dm_received',
                title: `New message from ${dm.sender.displayName}`,
                body: dto.content?.slice(0, 100) ?? '📎 Media',
                referenceType: 'dm',
                referenceId: dm.id,
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.DM_SEND, audit_logger_1.ResourceTypes.DM, dm.id, 1, { receiverId: otherUserId });
            return dm;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('DmService.sendDm error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Mark thread as read ───────────────────────────────────────────────────
    async markRead(otherUserId, actor) {
        try {
            const result = await connection_1.prisma.directMessage.updateMany({
                where: {
                    senderId: otherUserId,
                    receiverId: actor.userId,
                    isRead: false,
                    isDeletedByReceiver: false,
                },
                data: { isRead: true },
            });
            if (result.count > 0) {
                socket_service_1.SocketService.emitToRoom(`user:${otherUserId}`, socket_events_1.SocketEvents.DM_READ, {
                    sender_id: actor.userId,
                });
            }
            return { count: result.count };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('DmService.markRead error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Delete DM (soft, per-side) ────────────────────────────────────────────
    async deleteDm(dmId, actor) {
        try {
            const dm = await connection_1.prisma.directMessage.findUnique({
                where: { id: dmId },
                select: { id: true, senderId: true, receiverId: true },
            });
            if (!dm)
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Message'), http_status_codes_1.StatusCodes.NOT_FOUND);
            if (dm.senderId !== actor.userId && dm.receiverId !== actor.userId) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            const isSender = dm.senderId === actor.userId;
            await connection_1.prisma.directMessage.update({
                where: { id: dmId },
                data: isSender ? { isDeletedBySender: true } : { isDeletedByReceiver: true },
            });
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('DmService.deleteDm error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
exports.DmService = DmService;
exports.dmService = new DmService();
//# sourceMappingURL=dm.service.js.map