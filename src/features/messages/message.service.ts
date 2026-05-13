import { StatusCodes } from 'http-status-codes';
import { randomUUID } from 'crypto';
import { prisma } from '../../database/connection';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import { asLogger } from '../../shared/utils/asLogger';
import { AuditLogger, LogActions, ResourceTypes } from '../../shared/utils/audit.logger';
import { TokenPayload } from '../../shared/types/common.types';
import { SocketService } from '../../shared/socket/socket.service';
import { SocketEvents } from '../../shared/socket/socket.events';
import { StorageService } from '../../shared/storage/storage.service';
import {
    SendMessageDTO,
    ListMessagesQuery,
    MessagePublic,
    UploadedMessageMedia,
    messageSelect,
} from './message.types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireActiveMember(groupId: string, userId: string): Promise<{ role: string }> {
    const m = await prisma.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { role: true, status: true },
    });
    if (!m || m.status !== 'active') {
        throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
    }
    return m;
}

async function requireGroupAdmin(groupId: string, userId: string): Promise<void> {
    const m = await prisma.membership.findUnique({
        where: { userId_groupId: { userId, groupId } },
        select: { role: true, status: true },
    });
    if (!m || m.status !== 'active' || !['super_admin', 'admin'].includes(m.role)) {
        throw new ApiError(Messages.FORBIDDEN, StatusCodes.FORBIDDEN);
    }
}

// ─── MessageService ───────────────────────────────────────────────────────────

export class MessageService {
    // ── List messages (cursor-based) ──────────────────────────────────────────

    async listMessages(
        groupId: string,
        query: ListMessagesQuery,
        actor: TokenPayload,
    ): Promise<{ data: MessagePublic[]; next_cursor: string | null; has_more: boolean }> {
        try {
            await requireActiveMember(groupId, actor.userId);

            const limit = Math.min(query.limit ?? 50, 100);
            const direction = query.direction ?? 'before';
            const where: Record<string, unknown> = { groupId };

            if (query.cursor) {
                const cursorRow = await prisma.message.findUnique({
                    where: { id: query.cursor },
                    select: { createdAt: true },
                });
                if (cursorRow) {
                    where.createdAt = direction === 'before'
                        ? { lt: cursorRow.createdAt }
                        : { gt: cursorRow.createdAt };
                }
            }

            const data = await prisma.message.findMany({
                where: where as any,
                select: messageSelect,
                orderBy: { createdAt: direction === 'before' ? 'desc' : 'asc' },
                take: limit + 1,
            });

            const has_more = data.length > limit;
            if (has_more) data.pop();

            // Update read receipt
            await prisma.chatReadReceipt.upsert({
                where: { userId_groupId: { userId: actor.userId, groupId } },
                create: { userId: actor.userId, groupId, lastReadAt: new Date() },
                update: { lastReadAt: new Date() },
            });

            return {
                data,
                next_cursor: has_more ? data[data.length - 1].id : null,
                has_more,
            };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MessageService.listMessages error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Send message (REST fallback) ──────────────────────────────────────────

    async sendMessage(
        groupId: string,
        dto: SendMessageDTO,
        actor: TokenPayload,
        media?: UploadedMessageMedia,
    ): Promise<MessagePublic> {
        try {
            const membership = await requireActiveMember(groupId, actor.userId);
            const group = await prisma.group.findUnique({
                where: { id: groupId, deletedAt: null },
                select: { isChatLocked: true, status: true },
            });

            if (!group || group.status !== 'active') {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);
            }
            if (group.isChatLocked && !['super_admin', 'admin'].includes(membership.role)) {
                throw new ApiError('Chat is locked. Only admins can send messages.', StatusCodes.FORBIDDEN);
            }

            let mediaUrl = dto.media_url ?? null;
            let messageType = dto.message_type ?? 'text';

            if (media) {
                const result = await StorageService.upload(media.buffer, media.mimeType, {
                    folder:   `groupsync/messages/${groupId}`,
                    publicId: `${actor.userId}-${Date.now()}-${randomUUID()}`,
                    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
                });
                mediaUrl = result.url;
                messageType = 'image';
            }

            if (!dto.content?.trim() && !mediaUrl) {
                throw new ApiError('Message content or media is required.', StatusCodes.UNPROCESSABLE_ENTITY);
            }

            const message = await prisma.message.create({
                data: {
                    groupId,
                    senderId: actor.userId,
                    content: dto.content?.trim() ?? null,
                    messageType,
                    mediaUrl,
                    replyToId: dto.reply_to_id ?? null,
                },
                select: messageSelect,
            });

            SocketService.emitToRoom(`group:${groupId}`, SocketEvents.NEW_MESSAGE, { message });
            AuditLogger.log(actor, LogActions.MESSAGE_SEND, ResourceTypes.MESSAGE, message.id, 1, { groupId });

            return message;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MessageService.sendMessage error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Delete message ────────────────────────────────────────────────────────

    async deleteMessage(messageId: string, actor: TokenPayload): Promise<void> {
        try {
            const message = await prisma.message.findUnique({
                where: { id: messageId },
                select: { id: true, groupId: true, senderId: true, isDeleted: true },
            });
            if (!message || message.isDeleted) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Message'), StatusCodes.NOT_FOUND);
            }

            // Sender can always delete their own; group admin can delete any
            if (message.senderId !== actor.userId) {
                await requireGroupAdmin(message.groupId, actor.userId);
            }

            await prisma.message.update({
                where: { id: messageId },
                data: { isDeleted: true, content: null },
            });

            SocketService.emitToRoom(`group:${message.groupId}`, SocketEvents.MESSAGE_DELETED, {
                message_id: messageId,
                group_id: message.groupId,
            });
            AuditLogger.log(actor, LogActions.MESSAGE_DELETE, ResourceTypes.MESSAGE, messageId, 1);
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MessageService.deleteMessage error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Pin / unpin message ───────────────────────────────────────────────────

    async togglePin(messageId: string, actor: TokenPayload): Promise<MessagePublic> {
        try {
            const message = await prisma.message.findUnique({
                where: { id: messageId },
                select: { id: true, groupId: true, isPinned: true, isDeleted: true },
            });
            if (!message || message.isDeleted) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Message'), StatusCodes.NOT_FOUND);
            }

            await requireGroupAdmin(message.groupId, actor.userId);

            const updated = await prisma.message.update({
                where: { id: messageId },
                data: { isPinned: !message.isPinned },
                select: messageSelect,
            });

            SocketService.emitToRoom(`group:${message.groupId}`, SocketEvents.MESSAGE_PINNED, {
                message_id: messageId,
                group_id: message.groupId,
                is_pinned: updated.isPinned,
            });
            AuditLogger.log(actor, LogActions.MESSAGE_PIN, ResourceTypes.MESSAGE, messageId, 1);

            return updated;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MessageService.togglePin error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Add reaction ──────────────────────────────────────────────────────────

    async addReaction(messageId: string, emoji: string, actor: TokenPayload): Promise<void> {
        try {
            const message = await prisma.message.findUnique({
                where: { id: messageId },
                select: { id: true, groupId: true, isDeleted: true },
            });
            if (!message || message.isDeleted) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Message'), StatusCodes.NOT_FOUND);
            }

            await requireActiveMember(message.groupId, actor.userId);

            const existing = await prisma.messageReaction.findUnique({
                where: { messageId_userId_emoji: { messageId, userId: actor.userId, emoji } },
                select: { id: true },
            });
            if (existing) {
                throw new ApiError('You already reacted with this emoji.', StatusCodes.CONFLICT);
            }

            await prisma.messageReaction.create({
                data: { messageId, userId: actor.userId, emoji },
            });

            SocketService.emitToRoom(`group:${message.groupId}`, SocketEvents.REACTION_ADDED, {
                message_id: messageId,
                emoji,
                user_id: actor.userId,
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MessageService.addReaction error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Remove reaction ───────────────────────────────────────────────────────

    async removeReaction(messageId: string, emoji: string, actor: TokenPayload): Promise<void> {
        try {
            const reaction = await prisma.messageReaction.findUnique({
                where: { messageId_userId_emoji: { messageId, userId: actor.userId, emoji } },
                select: { id: true, message: { select: { groupId: true } } },
            });
            if (!reaction) {
                throw new ApiError(Messages.RESOURCE_NOT_FOUND('Reaction'), StatusCodes.NOT_FOUND);
            }

            await prisma.messageReaction.delete({
                where: { messageId_userId_emoji: { messageId, userId: actor.userId, emoji } },
            });

            SocketService.emitToRoom(`group:${reaction.message.groupId}`, SocketEvents.REACTION_REMOVED, {
                message_id: messageId,
                emoji,
                user_id: actor.userId,
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MessageService.removeReaction error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── List pinned messages ──────────────────────────────────────────────────

    async listPinned(groupId: string, actor: TokenPayload): Promise<MessagePublic[]> {
        try {
            await requireActiveMember(groupId, actor.userId);
            return prisma.message.findMany({
                where: { groupId, isPinned: true, isDeleted: false },
                select: messageSelect,
                orderBy: { createdAt: 'desc' },
            });
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MessageService.listPinned error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Toggle group chat lock ─────────────────────────────────────────────────

    async toggleChatLock(groupId: string, locked: boolean, actor: TokenPayload): Promise<{ is_chat_locked: boolean }> {
        try {
            await requireGroupAdmin(groupId, actor.userId);

            const group = await prisma.group.findUnique({
                where: { id: groupId, deletedAt: null },
                select: { id: true },
            });
            if (!group) throw new ApiError(Messages.RESOURCE_NOT_FOUND('Group'), StatusCodes.NOT_FOUND);

            await prisma.group.update({
                where: { id: groupId },
                data: { isChatLocked: locked },
            });

            SocketService.emitToRoom(`group:${groupId}`, SocketEvents.CHAT_LOCK_CHANGED, {
                group_id: groupId,
                is_chat_locked: locked,
                locked_by: actor.userId,
            });

            AuditLogger.log(
                actor,
                locked ? LogActions.CHAT_LOCK : LogActions.CHAT_UNLOCK,
                ResourceTypes.GROUP,
                groupId,
                1,
            );

            return { is_chat_locked: locked };
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MessageService.toggleChatLock error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}

export const messageService = new MessageService();
