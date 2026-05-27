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
            max: 3,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
        });
        const adapter = new PrismaPg(this.pool);
        this._client = new PrismaClient({ adapter });
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
            await this._client.$connect(); // internally validates the connection via the adapter
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
