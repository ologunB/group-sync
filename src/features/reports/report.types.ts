import { Prisma } from '@prisma/client';

export const REPORT_TARGET_TYPES = ['user', 'group', 'message'] as const;
export const REPORT_REASONS = [
    'spam',
    'harassment',
    'hate_speech',
    'fake_profile',
    'inappropriate_content',
    'other',
] as const;
export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface SubmitReportDTO {
    target_type: ReportTargetType;
    target_id: string;
    reason: string;
    description?: string;
}

export const reportSelect = {
    id: true,
    reporterId: true,
    targetType: true,
    targetId: true,
    reason: true,
    description: true,
    status: true,
    createdAt: true,
} as const satisfies Prisma.ReportSelect;

export type ReportPublic = Prisma.ReportGetPayload<{ select: typeof reportSelect }>;
