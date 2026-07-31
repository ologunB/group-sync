import { Queue, Worker, Job, QueueOptions, WorkerOptions } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './shared/config/app.config';
import { asLogger } from './shared/utils/asLogger';
import { EmailService, EmailOptions } from './shared/queues/mail.service';

// ─── Job name registry ────────────────────────────────────────────────────────

export type JobName =
    | 'send-email'
    | 'send-push-notification'
    | 'kyc-review-request'
    | 'kyc-document-cleanup'
    | 'storage-cleanup'
    | 'expire-invite-links'
    | 'notify-group-members'
    | 'process-group-announcement'
    | 'notify-platform-admin';

// ─── Connection (BullMQ requires maxRetriesPerRequest: null) ──────────────────

const redisUrl = config.redis.url;
const isTlsRedis = redisUrl.startsWith('rediss://');

const makeConnection = () => {
    const conn = new IORedis(redisUrl, {
        maxRetriesPerRequest: null,  // BullMQ requirement — commands queue until Redis is ready
        enableReadyCheck: false,
        lazyConnect: true,
        connectTimeout: 5000,
        // No commandTimeout — it would cause Command timed out unhandledRejections
        // while the connection is retrying. maxRetriesPerRequest: null handles backpressure.
        ...(isTlsRedis ? { tls: { rejectUnauthorized: false } } : {}),
    });
    // Prevent unhandled 'error' events from crashing the process during reconnection
    conn.on('error', (err) => asLogger.warn('BullMQ Redis connection error:', err.message));
    return conn;
};

// ─── Queue defaults ───────────────────────────────────────────────────────────

const QUEUE_NAME = 'system-jobs';

// How long a request may wait for a job to be accepted by Redis before it gives up and responds.
const ENQUEUE_TIMEOUT_MS = 2_000;

const defaultJobOptions = {
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 10_000 },
    removeOnComplete: true,
    removeOnFail: 20,
};

// ─── AgendaManager ────────────────────────────────────────────────────────────

export class AgendaManager {
    private static queue: Queue;
    private static worker: Worker;
    private static started = false;

    static async start(): Promise<void> {
        if (AgendaManager.started) return;

        const queueConnection = makeConnection();
        const workerConnection = makeConnection();

        // BullMQ manages its own reconnection. noeviction is best-effort on managed Redis.
        queueConnection.once('ready', () => {
            queueConnection.config('SET', 'maxmemory-policy', 'noeviction').catch(() => {});
        });

        const queueOptions: QueueOptions = {
            connection: queueConnection,
            defaultJobOptions,
        };

        AgendaManager.queue = new Queue(QUEUE_NAME, queueOptions);

        const workerOptions: WorkerOptions = {
            connection: workerConnection,
            concurrency: 5,
        };

        AgendaManager.worker = new Worker(
            QUEUE_NAME,
            AgendaManager.processor,
            workerOptions,
        );

        AgendaManager.worker.on('completed', (job) => {
            asLogger.info(`Job completed: ${job.name}`, { jobId: job.id });
        });

        AgendaManager.worker.on('failed', (job, err) => {
            asLogger.error(`Job failed: ${job?.name}`, { jobId: job?.id, error: err.message });
        });

        AgendaManager.worker.on('error', (err) => {
            asLogger.error('BullMQ worker error:', err);
        });

        AgendaManager.started = true;
        asLogger.info('AgendaManager started');

        // Register cron jobs fire-and-forget — they complete once Redis is ready
        AgendaManager.registerCronJobs().catch((err) => {
            asLogger.error('AgendaManager: failed to register cron jobs', err);
        });
    }

    static async stop(): Promise<void> {
        if (!AgendaManager.started) return;
        try {
            await AgendaManager.worker?.close();
            await AgendaManager.queue?.close();
            AgendaManager.started = false;
            asLogger.info('AgendaManager stopped');
        } catch (err) {
            asLogger.error('AgendaManager.stop error:', err);
        }
    }

    // ─── Job dispatcher ───────────────────────────────────────────────────────────

    static async sendEmail(data: EmailOptions): Promise<void> {
        await AgendaManager.enqueue('send-email', data);
    }

    static async runNow(name: JobName, data: Record<string, unknown>): Promise<void> {
        await AgendaManager.enqueue(name, data);
    }

    static async scheduleTask(
        when: string | Date,
        name: JobName,
        data: Record<string, unknown>,
    ): Promise<void> {
        let delay = 0;

        if (when === 'now') {
            delay = 0;
        } else if (typeof when === 'string' && when.startsWith('in ')) {
            // e.g. 'in 5 minutes', 'in 2 hours'
            const parts = when.replace('in ', '').split(' ');
            const amount = parseInt(parts[0], 10);
            const unit = parts[1];
            if (unit.startsWith('minute')) delay = amount * 60 * 1000;
            else if (unit.startsWith('hour')) delay = amount * 60 * 60 * 1000;
            else if (unit.startsWith('day')) delay = amount * 24 * 60 * 60 * 1000;
        } else if (when instanceof Date) {
            delay = Math.max(0, when.getTime() - Date.now());
        }

        await AgendaManager.queue.add(name, data, { ...defaultJobOptions, delay });
    }

    // ─── Internal: enqueue ────────────────────────────────────────────────────────

    private static async enqueue(name: JobName, data: unknown): Promise<void> {
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
        add.catch((err: Error) =>
            asLogger.error(`AgendaManager: failed to enqueue job "${name}"`, { err: err.message }),
        );

        let timer: NodeJS.Timeout | undefined;
        const settled = await Promise.race([
            add.then(() => 'ok' as const, () => 'failed' as const),
            new Promise<'timeout'>((resolve) => {
                timer = setTimeout(() => resolve('timeout'), ENQUEUE_TIMEOUT_MS);
                timer.unref();
            }),
        ]);
        if (timer) clearTimeout(timer);

        if (settled === 'timeout') {
            asLogger.warn(
                `AgendaManager: job "${name}" not confirmed within ${ENQUEUE_TIMEOUT_MS}ms — ` +
                'responding without it to avoid stranding the request',
            );
        }
    }

    // ─── Internal: job processor ──────────────────────────────────────────────────

    private static async processor(job: Job): Promise<void> {
        const name = job.name as JobName;

        switch (name) {
            case 'send-email': {
                await EmailService.send(job.data as EmailOptions);
                break;
            }

            case 'send-push-notification': {
                // TODO: Implement FCM push notification in push.service.ts
                asLogger.info('send-push-notification job received', { userId: job.data.userId });
                break;
            }

            case 'kyc-review-request': {
                if (config.kyc.enableAutoKyc) {
                    // TODO: Call KYC provider API (Smile Identity / Dojah / Prembly)
                    asLogger.info('kyc-review-request: auto-KYC enabled — calling provider', {
                        userId: job.data.userId,
                    });
                } else {
                    // Manual review: send admin notification email
                    asLogger.info('kyc-review-request: manual review required', {
                        userId: job.data.userId,
                        documentType: job.data.documentType,
                    });
                }
                break;
            }

            case 'kyc-document-cleanup': {
                // TODO: Delete document from S3/R2 using AWS SDK
                // The document URL has already been cleared from DB in auth.service.ts
                asLogger.info('kyc-document-cleanup: document marked for deletion', {
                    userId: job.data.userId,
                });
                break;
            }

            case 'storage-cleanup': {
                // TODO: Delete file from S3/R2
                asLogger.info('storage-cleanup job received', { key: job.data.key });
                break;
            }

            case 'expire-invite-links': {
                // Cron: mark expired invite links — query handled here via prisma import
                // We import prisma lazily to avoid circular deps in the module graph
                const { prisma } = await import('./database/connection');
                const now = new Date();
                const result = await prisma.inviteLink.updateMany({
                    where: {
                        expiresAt: { lt: now },
                        revokedAt: null,
                    },
                    data: { revokedAt: now },
                });
                asLogger.info(`expire-invite-links: expired ${result.count} links`);
                break;
            }

            case 'notify-group-members': {
                // Fan-out: individual push/in-app notifications per member
                // Implemented in notifications module
                asLogger.info('notify-group-members job received', { groupId: job.data.groupId });
                break;
            }

            case 'process-group-announcement': {
                asLogger.info('process-group-announcement job received', { groupId: job.data.groupId });
                break;
            }

            case 'notify-platform-admin': {
                asLogger.info('notify-platform-admin job received', { type: job.data.type, reportId: job.data.reportId });
                break;
            }

            default: {
                asLogger.warn(`AgendaManager: unknown job name "${name}"`, { jobId: job.id });
                break;
            }
        }
    }

    // ─── Internal: cron jobs ──────────────────────────────────────────────────────

    private static async registerCronJobs(): Promise<void> {
        // Expire invite links every hour
        await AgendaManager.queue.add(
            'expire-invite-links',
            {},
            {
                repeat: { pattern: '0 * * * *' },
                jobId: 'cron:expire-invite-links', // stable ID prevents duplicates
                removeOnComplete: true,
                removeOnFail: 5,
            },
        );

        asLogger.info('Cron jobs registered');
    }
}
