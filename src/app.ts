import express, { Application } from 'express';
import http from 'http';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { securityMiddleware } from './shared/middleware/security.middleware';
import { errorMiddleware, notFoundMiddleware } from './shared/middleware/error.middleware';
import { ResponseHelper } from './shared/utils/response.helper';
import { Database, redis } from './database/connection';
import { InitialSeeder } from './database/initial.seeder';
import { EmailService } from './shared/queues/mail.service';
import { AgendaManager } from './agenda';
import { config } from './shared/config/app.config';
import { asLogger } from './shared/utils/asLogger';

// Feature routers
import authRoutes from './features/auth/auth.routes';
import userRoutes from "./features/users/user.routes";

export class App {
    public readonly app: Application;
    public readonly httpServer: http.Server;

    constructor() {
        this.app = express();
        this.httpServer = http.createServer(this.app);

        // Order matters — always: middleware → routes → error handling
        this.configureMiddleware();
        this.configureRoutes();
        this.configureErrorHandling();
    }

    // ─── Middleware ──────────────────────────────────────────────────────────────

    private configureMiddleware(): void {
        // Reverse proxy trust (required for accurate req.ip behind nginx / load balancer)
        this.app.set('trust proxy', 1);

        this.app.use(express.json({ limit: '10mb' }));
        this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
        this.app.use(cookieParser());
        this.app.use(compression());

        // Security: helmet + cors + rate limiting
        securityMiddleware(this.app);
    }

    // ─── Routes ──────────────────────────────────────────────────────────────────

    private configureRoutes(): void {
        const { apiPrefix } = config.server;

        // Health check — always first, not rate-limited
        this.app.get(`${apiPrefix}/health`, (_req, res) => {
            ResponseHelper.success(res, {
                status: 'ok',
                environment: config.server.nodeEnv,
                timestamp: new Date().toISOString(),
            });
        });

        // Feature routes
        this.app.use(`${apiPrefix}/auth`, authRoutes);
        this.app.use(`${apiPrefix}/users`, userRoutes);
        // this.app.use(`${apiPrefix}/groups`, groupRoutes);
        // this.app.use(`${apiPrefix}/notifications`, notificationRoutes);
        // this.app.use(`${apiPrefix}/admin`, adminRoutes);
    }

    // ─── Error handling ──────────────────────────────────────────────────────────

    private configureErrorHandling(): void {
        // Global error handler — must come before 404
        this.app.use(errorMiddleware);

        // 404 catch-all — must be last
        this.app.use(notFoundMiddleware);
    }

    // ─── Startup sequence ────────────────────────────────────────────────────────

    async start(): Promise<void> {
        // 1. Connect to PostgreSQL
        await Database.getInstance().connect();

        // 2. Connect Redis (lazy connection — ensure it's ready)
        // await redis.connect();

        // 3. Run idempotent DB seeds
        await InitialSeeder.seed();

        // 4. Initialize email transporter
        EmailService.initialize();

        // 5. Start BullMQ queue + worker + cron jobs
        await AgendaManager.start();

        // 6. Socket.io will be attached here when the socket module is built:
        // SocketService.attach(this.httpServer);

        // 7. Start listening
        const { port, nodeEnv } = config.server;
        this.httpServer.listen(port, () => {
            asLogger.info(`GroupSync API listening on port ${port} [${nodeEnv}]`);
        });

        this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
                asLogger.error(`Port ${port} is already in use`);
            } else {
                asLogger.error('HTTP server error:', err);
            }
            process.exit(1);
        });
    }
}
