"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgendaManager = void 0;
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const app_config_1 = require("./shared/config/app.config");
const asLogger_1 = require("./shared/utils/asLogger");
const mail_service_1 = require("./shared/queues/mail.service");
// ─── Connection (BullMQ requires maxRetriesPerRequest: null) ──────────────────
const redisUrl = app_config_1.config.redis.url;
const isTlsRedis = redisUrl.startsWith('rediss://');
const makeConnection = () => new ioredis_1.default(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    ...(isTlsRedis ? { tls: { rejectUnauthorized: false } } : {}),
});
// ─── Queue defaults ───────────────────────────────────────────────────────────
const QUEUE_NAME = 'system-jobs';
const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: 20,
};
// ─── AgendaManager ────────────────────────────────────────────────────────────
class AgendaManager {
    static queue;
    static worker;
    static started = false;
    static async start() {
        if (AgendaManager.started)
            return;
        const queueConnection = makeConnection();
        const workerConnection = makeConnection();
        // BullMQ requires noeviction; silently ignored on managed Redis (Upstash, etc.)
        await queueConnection.config('SET', 'maxmemory-policy', 'noeviction').catch(() => { });
        const queueOptions = {
            connection: queueConnection,
            defaultJobOptions,
        };
        AgendaManager.queue = new bullmq_1.Queue(QUEUE_NAME, queueOptions);
        const workerOptions = {
            connection: workerConnection,
            concurrency: 5,
        };
        AgendaManager.worker = new bullmq_1.Worker(QUEUE_NAME, AgendaManager.processor, workerOptions);
        AgendaManager.worker.on('completed', (job) => {
            asLogger_1.asLogger.info(`Job completed: ${job.name}`, { jobId: job.id });
        });
        AgendaManager.worker.on('failed', (job, err) => {
            asLogger_1.asLogger.error(`Job failed: ${job?.name}`, { jobId: job?.id, error: err.message });
        });
        AgendaManager.worker.on('error', (err) => {
            asLogger_1.asLogger.error('BullMQ worker error:', err);
        });
        // Register recurring cron jobs
        await AgendaManager.registerCronJobs();
        AgendaManager.started = true;
        asLogger_1.asLogger.info('AgendaManager started');
    }
    static async stop() {
        if (!AgendaManager.started)
            return;
        try {
            await AgendaManager.worker?.close();
            await AgendaManager.queue?.close();
            AgendaManager.started = false;
            asLogger_1.asLogger.info('AgendaManager stopped');
        }
        catch (err) {
            asLogger_1.asLogger.error('AgendaManager.stop error:', err);
        }
    }
    // ─── Job dispatcher ───────────────────────────────────────────────────────────
    static async sendEmail(data) {
        await AgendaManager.enqueue('send-email', data);
    }
    static async runNow(name, data) {
        await AgendaManager.enqueue(name, data);
    }
    static async scheduleTask(when, name, data) {
        let delay = 0;
        if (when === 'now') {
            delay = 0;
        }
        else if (typeof when === 'string' && when.startsWith('in ')) {
            // e.g. 'in 5 minutes', 'in 2 hours'
            const parts = when.replace('in ', '').split(' ');
            const amount = parseInt(parts[0], 10);
            const unit = parts[1];
            if (unit.startsWith('minute'))
                delay = amount * 60 * 1000;
            else if (unit.startsWith('hour'))
                delay = amount * 60 * 60 * 1000;
            else if (unit.startsWith('day'))
                delay = amount * 24 * 60 * 60 * 1000;
        }
        else if (when instanceof Date) {
            delay = Math.max(0, when.getTime() - Date.now());
        }
        await AgendaManager.queue.add(name, data, { ...defaultJobOptions, delay });
    }
    // ─── Internal: enqueue ────────────────────────────────────────────────────────
    static async enqueue(name, data) {
        if (!AgendaManager.queue) {
            throw new Error('AgendaManager not started. Call AgendaManager.start() first.');
        }
        await AgendaManager.queue.add(name, data, defaultJobOptions);
    }
    // ─── Internal: job processor ──────────────────────────────────────────────────
    static async processor(job) {
        const name = job.name;
        switch (name) {
            case 'send-email': {
                await mail_service_1.EmailService.send(job.data);
                break;
            }
            case 'send-push-notification': {
                // TODO: Implement FCM push notification in push.service.ts
                asLogger_1.asLogger.info('send-push-notification job received', { userId: job.data.userId });
                break;
            }
            case 'kyc-review-request': {
                if (app_config_1.config.kyc.enableAutoKyc) {
                    // TODO: Call KYC provider API (Smile Identity / Dojah / Prembly)
                    asLogger_1.asLogger.info('kyc-review-request: auto-KYC enabled — calling provider', {
                        userId: job.data.userId,
                    });
                }
                else {
                    // Manual review: send admin notification email
                    asLogger_1.asLogger.info('kyc-review-request: manual review required', {
                        userId: job.data.userId,
                        documentType: job.data.documentType,
                    });
                }
                break;
            }
            case 'kyc-document-cleanup': {
                // TODO: Delete document from S3/R2 using AWS SDK
                // The document URL has already been cleared from DB in auth.service.ts
                asLogger_1.asLogger.info('kyc-document-cleanup: document marked for deletion', {
                    userId: job.data.userId,
                });
                break;
            }
            case 'storage-cleanup': {
                // TODO: Delete file from S3/R2
                asLogger_1.asLogger.info('storage-cleanup job received', { key: job.data.key });
                break;
            }
            case 'expire-invite-links': {
                // Cron: mark expired invite links — query handled here via prisma import
                // We import prisma lazily to avoid circular deps in the module graph
                // const { prisma } = await import('./database/connection');
                // const now = new Date();
                // const result = await prisma.inviteLink.updateMany({
                //     where: {
                //         expiresAt: { lt: now },
                //         revokedAt: null,
                //     },
                //     data: { revokedAt: now },
                // });
                // asLogger.info(`expire-invite-links: expired ${result.count} links`);
                break;
            }
            case 'notify-group-members': {
                // Fan-out: individual push/in-app notifications per member
                // Implemented in notifications module
                asLogger_1.asLogger.info('notify-group-members job received', { groupId: job.data.groupId });
                break;
            }
            case 'process-group-announcement': {
                asLogger_1.asLogger.info('process-group-announcement job received', { groupId: job.data.groupId });
                break;
            }
            case 'notify-platform-admin': {
                asLogger_1.asLogger.info('notify-platform-admin job received', { type: job.data.type, reportId: job.data.reportId });
                break;
            }
            default: {
                asLogger_1.asLogger.warn(`AgendaManager: unknown job name "${name}"`, { jobId: job.id });
                break;
            }
        }
    }
    // ─── Internal: cron jobs ──────────────────────────────────────────────────────
    static async registerCronJobs() {
        // Expire invite links every hour
        await AgendaManager.queue.add('expire-invite-links', {}, {
            repeat: { pattern: '0 * * * *' },
            jobId: 'cron:expire-invite-links', // stable ID prevents duplicates
            removeOnComplete: true,
            removeOnFail: 5,
        });
        asLogger_1.asLogger.info('Cron jobs registered');
    }
}
exports.AgendaManager = AgendaManager;
//# sourceMappingURL=agenda.js.map