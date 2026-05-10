"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportSelect = exports.REPORT_STATUSES = exports.REPORT_REASONS = exports.REPORT_TARGET_TYPES = void 0;
exports.REPORT_TARGET_TYPES = ['user', 'group', 'message'];
exports.REPORT_REASONS = [
    'spam',
    'harassment',
    'hate_speech',
    'fake_profile',
    'inappropriate_content',
    'other',
];
exports.REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'];
exports.reportSelect = {
    id: true,
    reporterId: true,
    targetType: true,
    targetId: true,
    reason: true,
    description: true,
    status: true,
    createdAt: true,
};
//# sourceMappingURL=report.types.js.map