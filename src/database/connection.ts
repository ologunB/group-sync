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
            max: 10,
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
            await this._client.$connect();
            await this.pool.query('SELECT 1');
            this._connected = true;
            asLogger.info('PostgreSQL connected successfully');
        } catch (error) {
            asLogger.error('PostgreSQL connection failed:', error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        await this._client.$disconnect();
        await this.pool.end();
        this._connected = false;
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
    commandTimeout: 5000,
    retryStrategy: (times: number) => {
        if (times > 5) {
            asLogger.error('Redis: max retry attempts reached, giving up');
            return null;
        }
        const delay = Math.min(times * 100, 3000);
        asLogger.warn(`Redis: retrying in ${delay}ms (attempt ${times})`);
        return delay;
    },
});

redis.on('connect', () => asLogger.info('Redis connected successfully'));
redis.on('ready', () => asLogger.info('Redis ready'));
redis.on('error', (err: Error) => asLogger.error('Redis error:', err));
redis.on('close', () => asLogger.warn('Redis connection closed'));
