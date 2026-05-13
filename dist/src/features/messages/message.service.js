"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.messageService = exports.MessageService = void 0;
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
const message_types_1 = require("./message.types");
// ─── Helpers ──────────────────────────────────────────────────────────────────
async function requireActiveMember(groupId, userId) {
    const m = await connection_1.prisma.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { role: true, status: true },
    });
    if (!m || m.status !== 'active') {
        throw new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN);
    }
    return m;
}
async function requireGroupAdmin(groupId, userId) {
    const m = await connection_1.prisma.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { role: true, status: true },
    });
    if (!m || m.status !== 'active' || !['super_admin', 'admin'].includes(m.role)) {
        throw new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN);
    }
}
// ─── MessageService ───────────────────────────────────────────────────────────
class MessageService {
    // ── List messages (cursor-based) ──────────────────────────────────────────
    async listMessages(groupId, query, actor) {
        try {
            await requireActiveMember(groupId, actor.userId);
            const limit = Math.min(query.limit ?? 50, 100);
            const direction = query.direction ?? 'before';
            const where = { groupId };
            if (query.cursor) {
                const cursorRow = await connection_1.prisma.message.findUnique({
                    where: { id: query.cursor },
                    select: { createdAt: true },
                });
                if (cursorRow) {
                    where.createdAt = direction === 'before'
                        ? { lt: cursorRow.createdAt }
                        : { gt: cursorRow.createdAt };
                }
            }
            const data = await connection_1.prisma.message.findMany({
                where: where,
                select: message_types_1.messageSelect,
                orderBy: { createdAt: direction === 'before' ? 'desc' : 'asc' },
                take: limit + 1,
            });
            const has_more = data.length > limit;
            if (has_more)
                data.pop();
            // Update read receipt
            await connection_1.prisma.chatReadReceipt.upsert({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                create: { userId: actor.userId, groupId, lastReadAt: new Date() },
                update: { lastReadAt: new Date() },
            });
            return {
                data,
                next_cursor: has_more ? data[data.length - 1].id : null,
                has_more,
            };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MessageService.listMessages error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Send message (REST fallback) ──────────────────────────────────────────
    async sendMessage(groupId, dto, actor, media) {
        try {
            const membership = await requireActiveMember(groupId, actor.userId);
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId, deletedAt: null },
                select: { isChatLocked: true, status: true },
            });
            if (!group || group.status !== 'active') {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (group.isChatLocked && !['super_admin', 'admin'].includes(membership.role)) {
                throw new error_middleware_1.ApiError('Chat is locked. Only admins can send messages.', http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            let mediaUrl = dto.media_url ?? null;
            let messageType = dto.message_type ?? 'text';
            if (media) {
                const result = await storage_service_1.StorageService.upload(media.buffer, media.mimeType, {
                    folder: `groupsync/messages/${groupId}`,
                    publicId: `${actor.userId}-${Date.now()}-${(0, crypto_1.randomUUID)()}`,
                    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
                });
                mediaUrl = result.url;
                messageType = 'image';
            }
            if (!dto.content?.trim() && !mediaUrl) {
                throw new error_middleware_1.ApiError('Message content or media is required.', http_status_codes_1.StatusCodes.UNPROCESSABLE_ENTITY);
            }
            const message = await connection_1.prisma.message.create({
                data: {
                    groupId,
                    senderId: actor.userId,
                    content: dto.content?.trim() ?? null,
                    messageType,
                    mediaUrl,
                    replyToId: dto.reply_to_id ?? null,
                },
                select: message_types_1.messageSelect,
            });
            socket_service_1.SocketService.emitToRoom(`group:${groupId}`, socket_events_1.SocketEvents.NEW_MESSAGE, { message });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.MESSAGE_SEND, audit_logger_1.ResourceTypes.MESSAGE, message.id, 1, { groupId });
            return message;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MessageService.sendMessage error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Delete message ────────────────────────────────────────────────────────
    async deleteMessage(messageId, actor) {
        try {
            const message = await connection_1.prisma.message.findUnique({
                where: { id: messageId },
                select: { id: true, groupId: true, senderId: true, isDeleted: true },
            });
            if (!message || message.isDeleted) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Message'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            // Sender can always delete their own; group admin can delete any
            if (message.senderId !== actor.userId) {
                await requireGroupAdmin(message.groupId, actor.userId);
            }
            await connection_1.prisma.message.update({
                where: { id: messageId },
                data: { isDeleted: true, content: null },
            });
            socket_service_1.SocketService.emitToRoom(`group:${message.groupId}`, socket_events_1.SocketEvents.MESSAGE_DELETED, {
                message_id: messageId,
                group_id: message.groupId,
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.MESSAGE_DELETE, audit_logger_1.ResourceTypes.MESSAGE, messageId, 1);
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MessageService.deleteMessage error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Pin / unpin message ───────────────────────────────────────────────────
    async togglePin(messageId, actor) {
        try {
            const message = await connection_1.prisma.message.findUnique({
                where: { id: messageId },
                select: { id: true, groupId: true, isPinned: true, isDeleted: true },
            });
            if (!message || message.isDeleted) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Message'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            await requireGroupAdmin(message.groupId, actor.userId);
            const updated = await connection_1.prisma.message.update({
                where: { id: messageId },
                data: { isPinned: !message.isPinned },
                select: message_types_1.messageSelect,
            });
            socket_service_1.SocketService.emitToRoom(`group:${message.groupId}`, socket_events_1.SocketEvents.MESSAGE_PINNED, {
                message_id: messageId,
                group_id: message.groupId,
                is_pinned: updated.isPinned,
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.MESSAGE_PIN, audit_logger_1.ResourceTypes.MESSAGE, messageId, 1);
            return updated;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MessageService.togglePin error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Add reaction ──────────────────────────────────────────────────────────
    async addReaction(messageId, emoji, actor) {
        try {
            const message = await connection_1.prisma.message.findUnique({
                where: { id: messageId },
                select: { id: true, groupId: true, isDeleted: true },
            });
            if (!message || message.isDeleted) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Message'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            await requireActiveMember(message.groupId, actor.userId);
            const existing = await connection_1.prisma.messageReaction.findUnique({
                where: { messageId_userId_emoji: { messageId, userId: actor.userId, emoji } },
                select: { id: true },
            });
            if (existing) {
                throw new error_middleware_1.ApiError('You already reacted with this emoji.', http_status_codes_1.StatusCodes.CONFLICT);
            }
            await connection_1.prisma.messageReaction.create({
                data: { messageId, userId: actor.userId, emoji },
            });
            socket_service_1.SocketService.emitToRoom(`group:${message.groupId}`, socket_events_1.SocketEvents.REACTION_ADDED, {
                message_id: messageId,
                emoji,
                user_id: actor.userId,
            });
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MessageService.addReaction error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Remove reaction ───────────────────────────────────────────────────────
    async removeReaction(messageId, emoji, actor) {
        try {
            const reaction = await connection_1.prisma.messageReaction.findUnique({
                where: { messageId_userId_emoji: { messageId, userId: actor.userId, emoji } },
                select: { id: true, message: { select: { groupId: true } } },
            });
            if (!reaction) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Reaction'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            await connection_1.prisma.messageReaction.delete({
                where: { messageId_userId_emoji: { messageId, userId: actor.userId, emoji } },
            });
            socket_service_1.SocketService.emitToRoom(`group:${reaction.message.groupId}`, socket_events_1.SocketEvents.REACTION_REMOVED, {
                message_id: messageId,
                emoji,
                user_id: actor.userId,
            });
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MessageService.removeReaction error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── List pinned messages ──────────────────────────────────────────────────
    async listPinned(groupId, actor) {
        try {
            await requireActiveMember(groupId, actor.userId);
            return connection_1.prisma.message.findMany({
                where: { groupId, isPinned: true, isDeleted: false },
                select: message_types_1.messageSelect,
                orderBy: { createdAt: 'desc' },
            });
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MessageService.listPinned error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Toggle group chat lock ─────────────────────────────────────────────────
    async toggleChatLock(groupId, locked, actor) {
        try {
            await requireGroupAdmin(groupId, actor.userId);
            const group = await connection_1.prisma.group.findUnique({
                where: { id: groupId, deletedAt: null },
                select: { id: true },
            });
            if (!group)
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Group'), http_status_codes_1.StatusCodes.NOT_FOUND);
            await connection_1.prisma.group.update({
                where: { id: groupId },
                data: { isChatLocked: locked },
            });
            socket_service_1.SocketService.emitToRoom(`group:${groupId}`, socket_events_1.SocketEvents.CHAT_LOCK_CHANGED, {
                group_id: groupId,
                is_chat_locked: locked,
                locked_by: actor.userId,
            });
            audit_logger_1.AuditLogger.log(actor, locked ? audit_logger_1.LogActions.CHAT_LOCK : audit_logger_1.LogActions.CHAT_UNLOCK, audit_logger_1.ResourceTypes.GROUP, groupId, 1);
            return { is_chat_locked: locked };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('MessageService.toggleChatLock error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
exports.MessageService = MessageService;
exports.messageService = new MessageService();
//# sourceMappingURL=message.service.js.map