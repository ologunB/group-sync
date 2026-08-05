"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const makeConnection = () => {
    const conn = new ioredis_1.default(redisUrl, {
        maxRetriesPerRequest: null, // BullMQ requirement — commands queue until Redis is ready
        enableReadyCheck: false,
        lazyConnect: true,
        connectTimeout: 5000,
        // No commandTimeout — it would cause Command timed out unhandledRejections
        // while the connection is retrying. maxRetriesPerRequest: null handles backpressure.
        ...(isTlsRedis ? { tls: { rejectUnauthorized: false } } : {}),
    });
    // Prevent unhandled 'error' events from crashing the process during reconnection
    conn.on('error', (err) => asLogger_1.asLogger.warn('BullMQ Redis connection error:', err.message));
    return conn;
};
// ─── Queue defaults ───────────────────────────────────────────────────────────
const QUEUE_NAME = 'system-jobs';
// How long a request may wait for a job to be accepted by Redis before it gives up and responds.
const ENQUEUE_TIMEOUT_MS = 2_000;
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
        // BullMQ manages its own reconnection. noeviction is best-effort on managed Redis.
        queueConnection.once('ready', () => {
            queueConnection.config('SET', 'maxmemory-policy', 'noeviction').catch(() => { });
        });
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
        AgendaManager.started = true;
        asLogger_1.asLogger.info('AgendaManager started');
        // Register cron jobs fire-and-forget — they complete once Redis is ready
        AgendaManager.registerCronJobs().catch((err) => {
            asLogger_1.asLogger.error('AgendaManager: failed to register cron jobs', err);
        });
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
        // Callers dispatch jobs *after* their DB write has committed, and the BullMQ connection
        // runs with maxRetriesPerRequest: null (a BullMQ requirement), so a reconnecting Redis
        // makes queue.add() queue the command indefinitely rather than reject. That stranded
        // completed requests with no response: the write landed, the client timed out, and the
        // user saw the action "fail" even though it had succeeded.
        //
        // Bound how long a request can wait on the enqueue. The add keeps running in the
        // background, so a job still lands if Redis recovers shortly after.
        const add = AgendaManager.queue.add(name, data, defaultJobOptions);
        add.catch((err) => asLogger_1.asLogger.error(`AgendaManager: failed to enqueue job "${name}"`, { err: err.message }));
        let timer;
        const settled = await Promise.race([
            add.then(() => 'ok', () => 'failed'),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve('timeout'), ENQUEUE_TIMEOUT_MS);
                timer.unref();
            }),
        ]);
        if (timer)
            clearTimeout(timer);
        if (settled === 'timeout') {
            asLogger_1.asLogger.warn(`AgendaManager: job "${name}" not confirmed within ${ENQUEUE_TIMEOUT_MS}ms — ` +
                'responding without it to avoid stranding the request');
        }
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
                const { prisma } = await Promise.resolve().then(() => __importStar(require('./database/connection')));
                const now = new Date();
                const result = await prisma.inviteLink.updateMany({
                    where: {
                        expiresAt: { lt: now },
                        revokedAt: null,
                    },
                    data: { revokedAt: now },
                });
                asLogger_1.asLogger.info(`expire-invite-links: expired ${result.count} links`);
                break;
            }
            case 'event-reminders': {
                // Hourly sweep: notifies RSVP holders 24 hours before an event starts.
                // Imported lazily — EventService pulls in AgendaManager, so a top-level
                // import here would close a cycle.
                const { eventService } = await Promise.resolve().then(() => __importStar(require('./features/events/event.service')));
                const { eventsReminded } = await eventService.sendUpcomingReminders();
                asLogger_1.asLogger.info(`event-reminders: reminded ${eventsReminded} event(s)`);
                break;
            }
            case 'notify-group-members': {
                // Retained for jobs already sitting in the queue from before delivery moved
                // into NotificationDispatcher — services now call the dispatcher directly
                // rather than round-tripping through BullMQ. Nothing enqueues this any more.
                asLogger_1.asLogger.warn('notify-group-members: legacy job drained, no action taken', {
                    groupId: job.data.groupId,
                });
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
        // Sweep for events starting in ~24 hours, every hour on the half hour so it does
        // not contend with the invite-link expiry job.
        await AgendaManager.queue.add('event-reminders', {}, {
            repeat: { pattern: '30 * * * *' },
            jobId: 'cron:event-reminders',
            removeOnComplete: true,
            removeOnFail: 5,
        });
        asLogger_1.asLogger.info('Cron jobs registered');
    }
}
exports.AgendaManager = AgendaManager;
//# sourceMappingURL=agenda.js.map