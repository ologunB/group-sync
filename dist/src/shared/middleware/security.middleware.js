"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.securityMiddleware = void 0;
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const rate_limit_redis_1 = require("rate-limit-redis");
const app_config_1 = require("../config/app.config");
const connection_1 = require("../../database/connection");
const asLogger_1 = require("../utils/asLogger");
// ─── Rate limit store factory ─────────────────────────────────────────────────
const makeRedisStore = (prefix) => new rate_limit_redis_1.RedisStore({
    // rate-limit-redis v4 API: sendCommand wraps ioredis
    sendCommand: (...args) => connection_1.redis.call(...args),
    prefix,
});
// The shared ioredis client runs with maxRetriesPerRequest: null (so commands queue instead of
// failing while Redis reconnects) and these limiters run before every handler — which means a
// stalled Redis silently stalls the entire API. Bound the limiter itself rather than the store:
// RedisStore.init() stores an un-awaited promise for its Lua script load, so making sendCommand
// reject on timeout instead surfaces as an unhandledRejection and kills the process.
//
// On timeout we fail open. A rate limiter that can take the API down is worse than one that
// occasionally lets a request through.
const RATE_LIMIT_TIMEOUT_MS = 1_000;
const failOpenOnStall = (limiter, label) => (req, res, next) => {
    let settled = false;
    const timer = setTimeout(() => {
        if (settled)
            return;
        settled = true;
        asLogger_1.asLogger.warn(`Rate limiter "${label}" stalled >${RATE_LIMIT_TIMEOUT_MS}ms — allowing request through`);
        next();
    }, RATE_LIMIT_TIMEOUT_MS);
    timer.unref();
    limiter(req, res, (err) => {
        if (settled)
            return; // already passed through on timeout
        settled = true;
        clearTimeout(timer);
        next(err);
    });
};
// ─── Rate limiters ────────────────────────────────────────────────────────────
// Auth routes: 10 requests / 15 minutes per IP
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('rl:auth:'),
    passOnStoreError: true, // Redis down => allow the request, never hang or 500
    message: {
        success: false,
        message: 'Too many authentication attempts. Please try again after 15 minutes.',
        data: null,
        error: null,
    },
    skip: () => !app_config_1.config.server.isProduction || app_config_1.config.server.testRoutesEnabled,
});
// General API: 100 requests / minute per authenticated user / IP
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('rl:api:'),
    passOnStoreError: true, // Redis down => allow the request, never hang or 500
    message: {
        success: false,
        message: 'Rate limit exceeded. Please slow down.',
        data: null,
        error: null,
    },
    skip: () => !app_config_1.config.server.isProduction,
});
// ─── CORS ─────────────────────────────────────────────────────────────────────
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, server-to-server)
        if (!origin)
            return callback(null, true);
        if (app_config_1.config.server.corsOrigins.includes(origin)) {
            return callback(null, true);
        }
        asLogger_1.asLogger.warn(`CORS: rejected request from origin ${origin}`);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Forwarded-For'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400, // 24 hours preflight cache
};
// ─── Main security middleware configurator ────────────────────────────────────
const securityMiddleware = (app) => {
    // HTTP security headers
    app.use((0, helmet_1.default)({
        contentSecurityPolicy: app_config_1.config.server.isProduction,
        crossOriginEmbedderPolicy: app_config_1.config.server.isProduction,
    }));
    // CORS
    app.use((0, cors_1.default)(corsOptions));
    app.options('*', (0, cors_1.default)(corsOptions)); // Pre-flight for all routes
    // Rate limiting — auth routes first (more restrictive), then general
    app.use(`${app_config_1.config.server.apiPrefix}/auth`, failOpenOnStall(authLimiter, 'auth'));
    app.use(app_config_1.config.server.apiPrefix, failOpenOnStall(apiLimiter, 'api'));
};
exports.securityMiddleware = securityMiddleware;
//# sourceMappingURL=security.middleware.js.map