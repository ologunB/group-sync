import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../database/connection';
import { redis } from '../../database/connection';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import { asLogger } from '../../shared/utils/asLogger';
import { AuditLogger, LogActions, ResourceTypes } from '../../shared/utils/audit.logger';
import { TokenPayload } from '../../shared/types/common.types';
import { AgendaManager } from '../../agenda';
import { SubmitReportDTO, ReportPublic, reportSelect } from './report.types';

// 5 reports per user per 24 hours
const REPORT_RATE_LIMIT = 5;
const REPORT_WINDOW_SECONDS = 24 * 60 * 60;

function reportRateLimitKey(userId: string): string {
    return `report:rate:${userId}`;
}

export class ReportService {
    async submitReport(dto: SubmitReportDTO, actor: TokenPayload): Promise<ReportPublic> {
        try {
            // Rate limit check via Redis
            const key = reportRateLimitKey(actor.userId);
            const current = await redis.incr(key);
            if (current === 1) {
                await redis.expire(key, REPORT_WINDOW_SECONDS);
            }
            if (current > REPORT_RATE_LIMIT) {
                throw new ApiError(
                    'You have reached the maximum of 5 reports per 24 hours.',
                    StatusCodes.TOO_MANY_REQUESTS,
                );
            }

            const report = await prisma.report.create({
                data: {
                    reporterId: actor.userId,
                    targetType: dto.target_type,
                    targetId: dto.target_id,
                    reason: dto.reason,
                    description: dto.description?.trim() ?? null,
                    status: 'open',
                },
                select: reportSelect,
            });

            // Notify platform admin queue
            await AgendaManager.runNow('notify-platform-admin', {
                type: 'new_report',
                reportId: report.id,
                targetType: dto.target_type,
                targetId: dto.target_id,
                reason: dto.reason,
            });

            AuditLogger.log(actor, LogActions.REPORT_SUBMIT, ResourceTypes.REPORT, report.id, 1, {
                targetType: dto.target_type,
                targetId: dto.target_id,
                reason: dto.reason,
            });

            return report;
        } catch (error) {
            AuditLogger.log(actor, LogActions.REPORT_SUBMIT, ResourceTypes.REPORT, null, 0, { error });
            if (error instanceof ApiError) throw error;
            asLogger.error('ReportService.submitReport error:', error);
            throw new ApiError(Messages.SERVER_ERROR, StatusCodes.INTERNAL_SERVER_ERROR);
        }
    }
}

export const reportService = new ReportService();
