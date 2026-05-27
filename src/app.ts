import express, { Application } from "express";
import http from "http";
import cookieParser from "cookie-parser";
import compression from "compression";
import { securityMiddleware } from "./shared/middleware/security.middleware";
import {
  errorMiddleware,
  notFoundMiddleware,
} from "./shared/middleware/error.middleware";
import { ResponseHelper } from "./shared/utils/response.helper";
import { Database, redis } from "./database/connection";
import { InitialSeeder } from "./database/initial.seeder";
import { EmailService } from "./shared/queues/mail.service";
import { AgendaManager } from "./agenda";
import { config } from "./shared/config/app.config";
import { asLogger } from "./shared/utils/asLogger";

// Feature routers
import authRoutes from "./features/auth/auth.routes";
import userRoutes from "./features/users/user.routes";
import groupRoutes from "./features/group/group.routes";
import membershipRoutes from "./features/membership/membership.routes";
import notificationRoutes from "./features/notifications/notification.routes";
import eventRoutes from "./features/events/event.routes";
import reportRoutes from "./features/reports/report.routes";
import adminRoutes from "./features/admin/admin.routes";
import messageRoutes from "./features/messages/message.routes";
import dmRoutes from "./features/dm/dm.routes";
import testRoutes from "./shared/utils/test.routes";
import { SocketService } from "./shared/socket/socket.service";

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
    this.app.set("trust proxy", 1);

    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));
    this.app.use(cookieParser());
    this.app.use(compression());

    // Security: helmet + cors + rate limiting
    securityMiddleware(this.app);
  }

  // ─── Routes ──────────────────────────────────────────────────────────────────

  private configureRoutes(): void {
    const { apiPrefix, serviceMode } = config.server;

    // Health check — always present regardless of service mode
    this.app.get(`${apiPrefix}/health`, (_req, res) => {
      ResponseHelper.success(res, {
        status: "ok",
        mode: serviceMode,
        environment: config.server.nodeEnv,
        timestamp: new Date().toISOString(),
      });
    });

    // REST routes are only mounted when mode is 'api' or 'both'
    if (serviceMode === 'api' || serviceMode === 'both') {
      this.app.use(`${apiPrefix}/auth`, authRoutes);
      this.app.use(`${apiPrefix}/users`, userRoutes);
      this.app.use(`${apiPrefix}/groups`, groupRoutes);
      this.app.use(`${apiPrefix}/groups`, membershipRoutes);
      this.app.use(`${apiPrefix}/notifications`, notificationRoutes);
      this.app.use(`${apiPrefix}`, eventRoutes);
      this.app.use(`${apiPrefix}/reports`, reportRoutes);
      this.app.use(`${apiPrefix}/admin`, adminRoutes);
      this.app.use(`${apiPrefix}`, messageRoutes);
      this.app.use(`${apiPrefix}`, dmRoutes);

      // Test-helper endpoints — only mounted when TEST_ROUTES_ENABLED=true
      if (config.server.testRoutesEnabled) {
        this.app.use(`${apiPrefix}/test`, testRoutes);
      }

      // Route manifest
      this.app.get(`${apiPrefix}/routes`, (_req, res) => {
        ResponseHelper.success(res, this.listRoutes(), "Route manifest");
      });
    }
  }

  private listRoutes(): Array<{ method: string; path: string }> {
    const routes: Array<{ method: string; path: string }> = [];

    function getPrefix(regexp: RegExp): string[] {
      if ((regexp as any).fast_slash) return [];
      const match = regexp
        .toString()
        .replace("\\/?", "")
        .replace("(?=\\/|$)", "$")
        .match(/^\/\^((?:\\[.*+?^${}()|[\]\\\/]|[^.*+?^${}()|[\]\\\/])*)\$\//);
      if (!match) return [];
      return match[1].replace(/\\(.)/g, "$1").split("/").filter(Boolean);
    }

    function walk(stack: any[], prefix: string[]): void {
      for (const layer of stack) {
        if (layer.route) {
          const methods = Object.keys(layer.route.methods)
            .filter((m) => layer.route.methods[m] && m !== "_all")
            .map((m) => m.toUpperCase());
          const parts = [
            ...prefix,
            ...layer.route.path.split("/").filter(Boolean),
          ];
          routes.push({
            method: methods.join(", "),
            path: "/" + parts.join("/"),
          });
        } else if (layer.handle?.stack) {
          walk(layer.handle.stack, [...prefix, ...getPrefix(layer.regexp)]);
        }
      }
    }

    const router = (this.app as any)._router;
    if (router?.stack) walk(router.stack, []);

    return routes.sort((a, b) => a.path.localeCompare(b.path));
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
    const { port, nodeEnv, serviceMode } = config.server;

    // 1. Connect to PostgreSQL
    await Database.getInstance().connect();

    // 2. Pre-warm Redis in the background — safe now that commandTimeout is removed.
    //    Errors surface via the 'error' event listener; startup is never blocked.
    redis.connect().catch(() => {});

    // 3. Run idempotent DB seeds
    await InitialSeeder.seed();

    // 4. Initialize email transporter
    EmailService.initialize();

    // 5. Start BullMQ queue + worker + cron jobs
    await AgendaManager.start();

    // 6. Socket.io — only when mode is 'socket' or 'both'
    if (serviceMode === 'socket' || serviceMode === 'both') {
      SocketService.attach(this.httpServer);
    }

    // 7. Start listening
    this.httpServer.listen(port, () => {
      asLogger.info(`GroupSync API listening on port ${port} [${nodeEnv}]`);
    });

    this.httpServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        asLogger.error(`Port ${port} is already in use`);
      } else {
        asLogger.error("HTTP server error:", err);
      }
      process.exit(1);
    });
  }
}
