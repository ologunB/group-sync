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
import { config } from '../../shared/config/app.config';
import { NotificationDispatcher } from '../notifications/notification.dispatcher';
import {
    SendMessageDTO,
    VotePollDTO,
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

/**
 * Notifies the author of a message that someone replied to it.
 *
 * Scoped to direct replies rather than every message in the group. Notifying the whole
 * room on every message is what makes a chat product's notifications worthless — the
 * signal that matters is "someone answered *you*". `message_reply` is in
 * NOTIFICATION_EMAIL_TYPES, so this is also the one chat event that can reach the inbox,
 * and the recipient can turn that off per group.
 *
 * Never throws: a chat message must not fail because a notification did.
 */
export async function notifyOnReply(
    messageId: string,
    groupId: string,
    replyToId: string | undefined,
    senderId: string,
): Promise<void> {
    if (!replyToId) return;

    try {
        const [parent, sender, group] = await Promise.all([
            prisma.message.findUnique({
                where: { id: replyToId },
                select: { senderId: true, groupId: true, isDeleted: true },
            }),
            prisma.user.findUnique({ where: { id: senderId }, select: { displayName: true } }),
            prisma.group.findUnique({ where: { id: groupId }, select: { name: true } }),
        ]);

        // Nothing to send when: the parent is gone or deleted, it belongs to another group,
        // its author's account was removed (senderId nulls out), or you replied to yourself.
        if (!parent || parent.isDeleted || parent.groupId !== groupId) return;
        if (!parent.senderId || parent.senderId === senderId) return;

        const recipientId = parent.senderId;

        // Still a member? Someone who left should not get pinged about the old room.
        const stillMember = await prisma.membership.findUnique({
            where: { userId_groupId: { userId: recipientId, groupId } },
            select: { status: true },
        });
        if (stillMember?.status !== 'active') return;

        const senderName = sender?.displayName ?? 'Someone';
        const groupName = group?.name ?? 'your group';

        await NotificationDispatcher.dispatch({
            userIds: [recipientId],
            groupId,
            type: 'message_reply',
            title: `${senderName} replied to you in ${groupName}`,
            body: `You have a new reply in ${groupName}.`,
            referenceType: 'message',
            referenceId: messageId,
            email: {
                subject: `${senderName} replied to you in ${groupName}`,
                template: 'message_reply',
                data: {
                    senderName,
                    groupName,
                    groupUrl: `${config.server.clientUrl}/groups/${groupId}/chat`,
                },
            },
        });
    } catch (error) {
        asLogger.error('MessageService.notifyOnReply error:', error);
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

            let storedMimeType = media?.mimeType ?? null;
            if (media) {
                const isAudio = media.mimeType.startsWith('audio/') || media.mimeType === 'video/webm';
                const result = await StorageService.upload(media.buffer, media.mimeType, {
                    folder:       `groupsync/messages/${groupId}`,
                    publicId:     `${actor.userId}-${Date.now()}-${randomUUID()}`,
                    resourceType: isAudio ? 'audio' : 'image',
                    transformation: isAudio ? undefined : [{ quality: 'auto', fetch_format: 'auto' }],
                });
                mediaUrl = result.url;
                messageType = isAudio ? 'audio' : 'image';
                storedMimeType = isAudio ? 'audio/mpeg' : media.mimeType; // audio transcoded to mp3
            }

            if (messageType === 'poll') {
                const p = dto.poll;
                if (!p?.question?.trim()) {
                    throw new ApiError('Poll question is required.', StatusCodes.UNPROCESSABLE_ENTITY);
                }
                if (!Array.isArray(p.options) || p.options.length < 2 || p.options.length > 10) {
                    throw new ApiError('Poll must have between 2 and 10 options.', StatusCodes.UNPROCESSABLE_ENTITY);
                }
                if (p.options.some((o) => !o?.trim())) {
                    throw new ApiError('All poll options must be non-empty strings.', StatusCodes.UNPROCESSABLE_ENTITY);
                }
            } else if (!dto.content?.trim() && !mediaUrl) {
                throw new ApiError('Message content or media is required.', StatusCodes.UNPROCESSABLE_ENTITY);
            }

            const message = await prisma.message.create({
                data: {
                    groupId,
                    senderId: actor.userId,
                    content: dto.content?.trim() ?? null,
                    messageType,
                    mediaUrl,
                    mediaMimeType: storedMimeType,
                    replyToId: dto.reply_to_id ?? null,
                    ...(messageType === 'poll' && dto.poll ? {
                        poll: {
                            create: {
                                question:   dto.poll.question.trim(),
                                isMultiple: dto.poll.is_multiple ?? false,
                                endsAt:     dto.poll.ends_at ? new Date(dto.poll.ends_at) : null,
                                options: {
                                    create: dto.poll.options.map((text, i) => ({
                                        text: text.trim(),
                                        position: i,
                                    })),
                                },
                            },
                        },
                    } : {}),
                },
                select: messageSelect,
            });

            SocketService.emitToRoom(`group:${groupId}`, SocketEvents.NEW_MESSAGE, { message });

            await notifyOnReply(message.id, groupId, dto.reply_to_id, actor.userId);

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

    // ── Vote on poll ──────────────────────────────────────────────────────────

    async votePoll(messageId: string, dto: VotePollDTO, actor: TokenPayload): Promise<MessagePublic> {
        try {
            const message = await prisma.message.findUnique({
                where: { id: messageId },
                select: { id: true, groupId: true, isDeleted: true, messageType: true,
                          poll: { select: { id: true, isMultiple: true, endsAt: true } } },
            });
            if (!message || message.isDeleted || message.messageType !== 'poll' || !message.poll) {
                throw new ApiError('Poll not found.', StatusCodes.NOT_FOUND);
            }
            if (message.poll.endsAt && message.poll.endsAt < new Date()) {
                throw new ApiError('This poll has ended.', StatusCodes.GONE);
            }

            await requireActiveMember(message.groupId, actor.userId);

            const option = await prisma.pollOption.findUnique({
                where: { id: dto.option_id },
                select: { id: true, pollId: true },
            });
            if (!option || option.pollId !== message.poll.id) {
                throw new ApiError('Poll option not found.', StatusCodes.NOT_FOUND);
            }

            const existing = await prisma.pollVote.findUnique({
                where: { optionId_userId: { optionId: dto.option_id, userId: actor.userId } },
                select: { id: true },
            });
            if (existing) {
                throw new ApiError('You have already voted for this option.', StatusCodes.CONFLICT);
            }

            if (!message.poll.isMultiple) {
                const priorVote = await prisma.pollVote.findFirst({
                    where: { pollId: message.poll.id, userId: actor.userId },
                    select: { id: true },
                });
                if (priorVote) {
                    throw new ApiError('You have already voted in this poll.', StatusCodes.CONFLICT);
                }
            }

            await prisma.pollVote.create({
                data: { optionId: dto.option_id, pollId: message.poll.id, userId: actor.userId },
            });

            const updated = await prisma.message.findUniqueOrThrow({
                where: { id: messageId },
                select: messageSelect,
            });

            SocketService.emitToRoom(`group:${message.groupId}`, SocketEvents.POLL_VOTE_UPDATED, {
                message_id: messageId,
                poll_id: message.poll.id,
                option_id: dto.option_id,
                user_id: actor.userId,
                action: 'vote',
            });
            AuditLogger.log(actor, LogActions.POLL_VOTE, ResourceTypes.MESSAGE, messageId, 1, { optionId: dto.option_id });

            return updated;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MessageService.votePoll error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }

    // ── Remove vote from poll ─────────────────────────────────────────────────

    async unvotePoll(messageId: string, dto: VotePollDTO, actor: TokenPayload): Promise<MessagePublic> {
        try {
            const message = await prisma.message.findUnique({
                where: { id: messageId },
                select: { id: true, groupId: true, isDeleted: true, messageType: true,
                          poll: { select: { id: true, endsAt: true } } },
            });
            if (!message || message.isDeleted || message.messageType !== 'poll' || !message.poll) {
                throw new ApiError('Poll not found.', StatusCodes.NOT_FOUND);
            }
            if (message.poll.endsAt && message.poll.endsAt < new Date()) {
                throw new ApiError('This poll has ended.', StatusCodes.GONE);
            }

            await requireActiveMember(message.groupId, actor.userId);

            const vote = await prisma.pollVote.findUnique({
                where: { optionId_userId: { optionId: dto.option_id, userId: actor.userId } },
                select: { id: true },
            });
            if (!vote) {
                throw new ApiError('Vote not found.', StatusCodes.NOT_FOUND);
            }

            await prisma.pollVote.delete({
                where: { optionId_userId: { optionId: dto.option_id, userId: actor.userId } },
            });

            const updated = await prisma.message.findUniqueOrThrow({
                where: { id: messageId },
                select: messageSelect,
            });

            SocketService.emitToRoom(`group:${message.groupId}`, SocketEvents.POLL_VOTE_UPDATED, {
                message_id: messageId,
                poll_id: message.poll.id,
                option_id: dto.option_id,
                user_id: actor.userId,
                action: 'unvote',
            });
            AuditLogger.log(actor, LogActions.POLL_UNVOTE, ResourceTypes.MESSAGE, messageId, 1, { optionId: dto.option_id });

            return updated;
        } catch (error) {
            if (error instanceof ApiError) throw error;
            asLogger.error('MessageService.unvotePoll error:', error);
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
