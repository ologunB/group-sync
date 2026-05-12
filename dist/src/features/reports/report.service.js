"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportService = exports.ReportService = void 0;
const http_status_codes_1 = require("http-status-codes");
const connection_1 = require("../../database/connection");
const connection_2 = require("../../database/connection");
const error_middleware_1 = require("../../shared/middleware/error.middleware");
const response_constants_1 = require("../../shared/utils/response.constants");
const asLogger_1 = require("../../shared/utils/asLogger");
const audit_logger_1 = require("../../shared/utils/audit.logger");
const agenda_1 = require("../../agenda");
const report_types_1 = require("./report.types");
// 5 reports per user per 24 hours
const REPORT_RATE_LIMIT = 5;
const REPORT_WINDOW_SECONDS = 24 * 60 * 60;
function reportRateLimitKey(userId) {
    return `report:rate:${userId}`;
}
class ReportService {
    async submitReport(dto, actor) {
        try {
            // Rate limit check via Redis
            const key = reportRateLimitKey(actor.userId);
            const current = await connection_2.redis.incr(key);
            if (current === 1) {
                await connection_2.redis.expire(key, REPORT_WINDOW_SECONDS);
            }
            if (current > REPORT_RATE_LIMIT) {
                throw new error_middleware_1.ApiError('You have reached the maximum of 5 reports per 24 hours.', http_status_codes_1.StatusCodes.TOO_MANY_REQUESTS);
            }
            const report = await connection_1.prisma.report.create({
                data: {
                    reporterId: actor.userId,
                    targetType: dto.target_type,
                    targetId: dto.target_id,
                    reason: dto.reason,
                    description: dto.description?.trim() ?? null,
                    status: 'open',
                },
                select: report_types_1.reportSelect,
            });
            // Notify platform admin queue
            await agenda_1.AgendaManager.runNow('notify-platform-admin', {
                type: 'new_report',
                reportId: report.id,
                targetType: dto.target_type,
                targetId: dto.target_id,
                reason: dto.reason,
            });
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.REPORT_SUBMIT, audit_logger_1.ResourceTypes.REPORT, report.id, 1, {
                targetType: dto.target_type,
                targetId: dto.target_id,
                reason: dto.reason,
            });
            return report;
        }
        catch (error) {
            audit_logger_1.AuditLogger.log(actor, audit_logger_1.LogActions.REPORT_SUBMIT, audit_logger_1.ResourceTypes.REPORT, null, 0, { error });
            if (error instanceof error_middleware_1.ApiError)
                throw error;
            asLogger_1.asLogger.error('ReportService.submitReport error:', error);
            throw new error_middleware_1.ApiError(response_constants_1.Messages.SERVER_ERROR, http_status_codes_1.StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}
exports.ReportService = ReportService;
exports.reportService = new ReportService();
//# sourceMappingURL=report.service.js.map