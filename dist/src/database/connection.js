"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.redis = exports.prisma = exports.Database = void 0;
const client_1 = require("@prisma/client");
const adapter_pg_1 = require("@prisma/adapter-pg");
const pg_1 = require("pg");
const ioredis_1 = __importDefault(require("ioredis"));
const app_config_1 = require("../shared/config/app.config");
const asLogger_1 = require("../shared/utils/asLogger");
// ─── Prisma / PostgreSQL ──────────────────────────────────────────────────────
class Database {
    static instance;
    _client;
    pool;
    _connected = false;
    constructor() {
        this.pool = new pg_1.Pool({
            connectionString: app_config_1.config.database.url,
            ssl: { rejectUnauthorized: false },
            max: 10,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
        });
        const adapter = new adapter_pg_1.PrismaPg(this.pool);
        this._client = new client_1.PrismaClient({ adapter });
    }
    static getInstance() {
        if (!Database.instance) {
            Database.instance = new Database();
        }
        return Database.instance;
    }
    async connect() {
        if (this._connected)
            return;
        try {
            await this._client.$connect();
            await this.pool.query('SELECT 1');
            this._connected = true;
            asLogger_1.asLogger.info('PostgreSQL connected successfully');
        }
        catch (error) {
            asLogger_1.asLogger.error('PostgreSQL connection failed:', error);
            throw error;
        }
    }
    async disconnect() {
        await this._client.$disconnect();
        await this.pool.end();
        this._connected = false;
        asLogger_1.asLogger.info('PostgreSQL disconnected');
    }
    get client() {
        return this._client;
    }
}
exports.Database = Database;
exports.prisma = Database.getInstance().client;
// ─── Redis ────────────────────────────────────────────────────────────────────
exports.redis = new ioredis_1.default(app_config_1.config.redis.url, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    connectTimeout: 5000,
    commandTimeout: 5000,
    retryStrategy: (times) => {
        if (times > 5) {
            asLogger_1.asLogger.error('Redis: max retry attempts reached, giving up');
            return null;
        }
        const delay = Math.min(times * 100, 3000);
        asLogger_1.asLogger.warn(`Redis: retrying in ${delay}ms (attempt ${times})`);
        return delay;
    },
});
exports.redis.on('connect', () => asLogger_1.asLogger.info('Redis connected successfully'));
exports.redis.on('ready', () => asLogger_1.asLogger.info('Redis ready'));
exports.redis.on('error', (err) => asLogger_1.asLogger.error('Redis error:', err));
exports.redis.on('close', () => asLogger_1.asLogger.warn('Redis connection closed'));
//# sourceMappingURL=connection.js.map