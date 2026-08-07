import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import IORedis from 'ioredis';
import { config } from '../shared/config/app.config';
import { asLogger } from '../shared/utils/asLogger';

// ─── Prisma / PostgreSQL ──────────────────────────────────────────────────────

class Database {
    private static instance: Database;
    private readonly _client: PrismaClient;
    private readonly pool: Pool;
    private _connected = false;

    private constructor() {
        this.pool = new Pool({
            connectionString: config.database.url,
            ssl: { rejectUnauthorized: false },
            // Most handlers use more than one connection (the query itself, plus the fire-and-forget
            // audit-log insert), so max: 3 meant ~2 concurrent requests before queueing. Measured
            // against production, p50 tripled at 5 concurrent requests. Goes through the transaction
            // pooler, which multiplexes, so this is well within budget.
            max: parseInt(process.env.DB_POOL_MAX ?? '10', 10),
            idleTimeoutMillis: 30_000,
            // Time allowed to *acquire* a connection — establishing a new one to the pooler
            // plus any wait for a free slot. 5s is comfortable same-region and far too tight
            // across regions: a link that needed longer failed roughly one write in three
            // with "Connection terminated due to connection timeout", surfacing as a 500 on
            // an otherwise valid request. Overridable so a distant deployment can raise it.
            connectionTimeoutMillis: parseInt(process.env.DB_CONNECT_TIMEOUT_MS ?? '15000', 10),
        });
        const adapter = new PrismaPg(this.pool);
        this._client = new PrismaClient({
            adapter,
            // Prisma aborts an interactive transaction after 5s by default, measured from
            // the moment it opens. That budget is spent on network round-trips, not work:
            // a three-write transaction against a pooler on a slow link took 8s and 500'd
            // a sign-up that would otherwise have succeeded. Round-trips are the cost, so
            // the ceiling has to be generous enough to absorb a bad link.
            transactionOptions: {
                timeout: parseInt(process.env.DB_TRANSACTION_TIMEOUT_MS ?? '20000', 10),
                maxWait: parseInt(process.env.DB_TRANSACTION_MAX_WAIT_MS ?? '10000', 10),
            },
        });
    }

    static getInstance(): Database {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }

    async connect(): Promise<void> {
        if (this._connected) return;

        try {
            // With a driver adapter, $connect() never opens a socket — it cannot surface a bad
            // host or bad credentials. Issue a real query so startup fails here, loudly, instead
            // of at whichever query happens to run first (previously the seeder).
            await this._client.$connect();
            await this._client.$queryRaw`SELECT 1`;
            this._connected = true;
            asLogger.info('PostgreSQL connected successfully');
        } catch (error) {
            asLogger.error('PostgreSQL connection failed:', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        if (!this._connected) return;
        this._connected = false;  // set first to block concurrent calls
        // With PrismaPg adapter, PrismaClient does not own the pool — calling $disconnect()
        // schedules internal async cleanup that races with pool.end() and triggers a pg@8
        // DeprecationWarning. End the pool first so no new queries can be issued, then let
        // $disconnect() clean up its internal state against an already-drained pool.
        try { await this.pool.end(); } catch { /* already ended */ }
        try { await this._client.$disconnect(); } catch { /* already disconnected */ }
        asLogger.info('PostgreSQL disconnected');
    }

    get client(): PrismaClient {
        return this._client;
    }
}

export { Database };
export const prisma = Database.getInstance().client;

// ─── Redis ────────────────────────────────────────────────────────────────────

export const redis = new IORedis(config.redis.url, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 5000,
    // No commandTimeout — ioredis applies it to its own internal setup commands
    // (CLIENT SETNAME, AUTH) whose promise rejections aren't always caught internally,
    // leaking as unhandledRejections. Request-level failures are handled by try-catch
    // in service code plus retryStrategy giving up.
    retryStrategy: (times: number) => {
        if (times > 5) {
            asLogger.error('Redis: max retry attempts reached, giving up');
            return null;
        }
        const delay = Math.min(times * 200, 3000);
        asLogger.warn(`Redis: retrying in ${delay}ms (attempt ${times})`);
        return delay;
    },
});

redis.on('connect', () => asLogger.info('Redis connected successfully'));
redis.on('ready', () => asLogger.info('Redis ready'));
redis.on('error', (err: Error) => asLogger.error('Redis error:', err));
redis.on('close', () => asLogger.warn('Redis connection closed'));
