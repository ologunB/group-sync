import { Application } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { config } from '../config/app.config';
import { redis } from '../../database/connection';
import { asLogger } from '../utils/asLogger';

// ─── Rate limit store factory ─────────────────────────────────────────────────

const makeRedisStore = (prefix: string) =>
    new RedisStore({
        // rate-limit-redis v4 API: sendCommand wraps ioredis
        sendCommand: (...args: string[]) => (redis as any).call(...args),
        prefix,
    });

// ─── Rate limiters ────────────────────────────────────────────────────────────

// Auth routes: 10 requests / 15 minutes per IP
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('rl:auth:'),
    message: {
        success: false,
        message: 'Too many authentication attempts. Please try again after 15 minutes.',
        data: null,
        error: null,
    },
    skip: () => !config.server.isProduction || config.server.testRoutesEnabled,
});

// General API: 100 requests / minute per authenticated user / IP
const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    store: makeRedisStore('rl:api:'),
    message: {
        success: false,
        message: 'Rate limit exceeded. Please slow down.',
        data: null,
        error: null,
    },
    skip: () => !config.server.isProduction,
});

// ─── CORS ─────────────────────────────────────────────────────────────────────

const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, server-to-server)
        if (!origin) return callback(null, true);

        if (config.server.corsOrigins.includes(origin)) {
            return callback(null, true);
        }

        asLogger.warn(`CORS: rejected request from origin ${origin}`);
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Forwarded-For'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400, // 24 hours preflight cache
};

// ─── Main security middleware configurator ────────────────────────────────────

export const securityMiddleware = (app: Application): void => {
    // HTTP security headers
    app.use(
        helmet({
            contentSecurityPolicy: config.server.isProduction,
            crossOriginEmbedderPolicy: config.server.isProduction,
        }),
    );

    // CORS
    app.use(cors(corsOptions));
    app.options('*', cors(corsOptions)); // Pre-flight for all routes

    // Rate limiting — auth routes first (more restrictive), then general
    app.use(`${config.server.apiPrefix}/auth`, authLimiter);
    app.use(config.server.apiPrefix, apiLimiter);
};
