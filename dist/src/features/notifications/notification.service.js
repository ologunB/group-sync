"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationService = exports.NotificationService = void 0;
const http_status_codes_1 = require("http-status-codes");
const connection_1 = require("../../database/connection");
const error_middleware_1 = require("../../shared/middleware/error.middleware");
const response_constants_1 = require("../../shared/utils/response.constants");
const asLogger_1 = require("../../shared/utils/asLogger");
const audit_logger_1 = require("../../shared/utils/audit.logger");
const notification_types_1 = require("./notification.types");
class NotificationService {
    // ── List notifications (cursor-based) ─────────────────────────────────────
    async listNotifications(query, actor) {
        try {
            const limit = Math.min(query.limit ?? 20, 50);
            const where = { userId: actor.userId };
            if (query.unread_only)
                where.isRead = false;
            // Cursor: fetch records older than the cursor notification's createdAt
            if (query.cursor) {
                const cursorRow = await connection_1.prisma.notification.findUnique({
                    where: { id: query.cursor },
                    select: { createdAt: true },
                });
                if (cursorRow) {
                    where.createdAt = { lt: cursorRow.createdAt };
                }
            }
            const [data, unread_count] = await Promise.all([
                connection_1.prisma.notification.findMany({
                    where: where,
                    select: notification_types_1.notificationSelect,
                    orderBy: { createdAt: 'desc' },
                    take: limit + 1,
                }),
                connection_1.prisma.notification.count({ where: { userId: actor.userId, isRead: false } }),
            ]);
            const has_more = data.length > limit;
            if (has_more)
                data.pop();
            return {
                data,
                next_cursor: has_more ? data[data.length - 1].id : null,
                has_more,
                unread_count,
            };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('NotificationService.listNotifications error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Mark single notification as read ─────────────────────────────────────
    async markRead(notificationId, actor) {
        try {
            const notification = await connection_1.prisma.notification.findUnique({
                where: { id: notificationId },
                select: { userId: true },
            });
            if (!notification) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Notification'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (notification.userId !== actor.userId) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            const updated = await connection_1.prisma.notification.update({
                where: { id: notificationId },
                data: { isRead: true },
                select: notification_types_1.notificationSelect,
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.NOTIFICATION_READ, audit_logger_1.ResourceTypes.NOTIFICATION, notificationId, 1);
            return updated;
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('NotificationService.markRead error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Mark all notifications as read ────────────────────────────────────────
    async markAllRead(actor) {
        try {
            const result = await connection_1.prisma.notification.updateMany({
                where: { userId: actor.userId, isRead: false },
                data: { isRead: true },
            });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.NOTIFICATION_READ_ALL, audit_logger_1.ResourceTypes.NOTIFICATION, null, 1, { count: result.count });
            return { count: result.count };
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('NotificationService.markAllRead error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Delete notification ───────────────────────────────────────────────────
    async deleteNotification(notificationId, actor) {
        try {
            const notification = await connection_1.prisma.notification.findUnique({
                where: { id: notificationId },
                select: { userId: true },
            });
            if (!notification) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.RESOURCE_NOT_FOUND('Notification'), http_status_codes_1.StatusCodes.NOT_FOUND);
            }
            if (notification.userId !== actor.userId) {
                throw new error_middleware_1.ApiError(response_constants_1.Messages.FORBIDDEN, http_status_codes_1.StatusCodes.FORBIDDEN);
            }
            await connection_1.prisma.notification.delete({ where: { id: notificationId } });
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.NOTIFICATION_DELETE, audit_logger_1.ResourceTypes.NOTIFICATION, notificationId, 1);
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('NotificationService.deleteNotification error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Get notification preferences ──────────────────────────────────────────
    async getPreferences(actor) {
        try {
            return connection_1.prisma.notificationPreference.findMany({
                where: { userId: actor.userId },
                select: notification_types_1.notificationPrefSelect,
                orderBy: { createdAt: 'asc' },
            });
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('NotificationService.getPreferences error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Update notification preferences ───────────────────────────────────────
    async updatePreferences(dto, actor) {
        try {
            // Upsert each preference individually — prisma upsert with nullable groupId in composite
            // unique key is unreliable because NULL != NULL in SQL unique constraints.
            for (const pref of dto.preferences) {
                const existing = await connection_1.prisma.notificationPreference.findFirst({
                    where: { userId: actor.userId, groupId: pref.group_id ?? null, prefType: pref.pref_type },
                    select: { id: true },
                });
                if (existing) {
                    await connection_1.prisma.notificationPreference.update({
                        where: { id: existing.id },
                        data: { pushEnabled: pref.push_enabled, inAppEnabled: pref.in_app_enabled },
                    });
                }
                else {
                    await connection_1.prisma.notificationPreference.create({
                        data: {
                            userId: actor.userId,
                            groupId: pref.group_id ?? null,
                            prefType: pref.pref_type,
                            pushEnabled: pref.push_enabled,
                            inAppEnabled: pref.in_app_enabled,
                        },
                    });
                }
            }
            await audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.NOTIFICATION_PREF_UPDATE, audit_logger_1.ResourceTypes.NOTIFICATION, null, 1);
            return this.getPreferences(actor);
        }
        catch (error) {
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('NotificationService.updatePreferences error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
    // ── Static helper: create a notification (used by other services) ─────────
    static async create(data) {
        try {
            await connection_1.prisma.notification.create({
                data: {
                    userId: data.userId,
                    type: data.type,
                    title: data.title,
                    body: data.body ?? null,
                    referenceType: data.referenceType ?? null,
                    referenceId: data.referenceId ?? null,
                },
            });
        }
        catch (err) {
            asLogger_1.asLogger.error('NotificationService.create error:', err);
        }
    }
}
exports.NotificationService = NotificationService;
exports.notificationService = new NotificationService();
//# sourceMappingURL=notification.service.js.map