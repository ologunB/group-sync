"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.App = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const compression_1 = __importDefault(require("compression"));
const security_middleware_1 = require("./shared/middleware/security.middleware");
const error_middleware_1 = require("./shared/middleware/error.middleware");
const response_helper_1 = require("./shared/utils/response.helper");
const connection_1 = require("./database/connection");
const initial_seeder_1 = require("./database/initial.seeder");
const mail_service_1 = require("./shared/queues/mail.service");
const agenda_1 = require("./agenda");
const app_config_1 = require("./shared/config/app.config");
const asLogger_1 = require("./shared/utils/asLogger");
// Feature routers
const auth_routes_1 = __importDefault(require("./features/auth/auth.routes"));
const user_routes_1 = __importDefault(require("./features/users/user.routes"));
const group_routes_1 = __importDefault(require("./features/group/group.routes"));
const membership_routes_1 = __importDefault(require("./features/membership/membership.routes"));
const notification_routes_1 = __importDefault(require("./features/notifications/notification.routes"));
const event_routes_1 = __importDefault(require("./features/events/event.routes"));
const report_routes_1 = __importDefault(require("./features/reports/report.routes"));
const admin_routes_1 = __importDefault(require("./features/admin/admin.routes"));
class App {
    app;
    httpServer;
    constructor() {
        this.app = (0, express_1.default)();
        this.httpServer = http_1.default.createServer(this.app);
        // Order matters — always: middleware → routes → error handling
        this.configureMiddleware();
        this.configureRoutes();
        this.configureErrorHandling();
    }
    // ─── Middleware ──────────────────────────────────────────────────────────────
    configureMiddleware() {
        // Reverse proxy trust (required for accurate req.ip behind nginx / load balancer)
        this.app.set("trust proxy", 1);
        this.app.use(express_1.default.json({ limit: "10mb" }));
        this.app.use(express_1.default.urlencoded({ extended: true, limit: "10mb" }));
        this.app.use((0, cookie_parser_1.default)());
        this.app.use((0, compression_1.default)());
        // Security: helmet + cors + rate limiting
        (0, security_middleware_1.securityMiddleware)(this.app);
    }
    // ─── Routes ──────────────────────────────────────────────────────────────────
    configureRoutes() {
        const { apiPrefix } = app_config_1.config.server;
        // Health check — always first, not rate-limited
        this.app.get(`${apiPrefix}/health`, (_req, res) => {
            response_helper_1.ResponseHelper.success(res, {
                status: "ok",
                environment: app_config_1.config.server.nodeEnv,
                timestamp: new Date().toISOString(),
            });
        });
        // Feature routes
        this.app.use(`${apiPrefix}/auth`, auth_routes_1.default);
        this.app.use(`${apiPrefix}/users`, user_routes_1.default);
        this.app.use(`${apiPrefix}/groups`, group_routes_1.default);
        this.app.use(`${apiPrefix}/groups`, membership_routes_1.default);
        this.app.use(`${apiPrefix}/notifications`, notification_routes_1.default);
        this.app.use(`${apiPrefix}`, event_routes_1.default);
        this.app.use(`${apiPrefix}/reports`, report_routes_1.default);
        this.app.use(`${apiPrefix}/admin`, admin_routes_1.default);
        // Route manifest
        this.app.get(`${apiPrefix}/routes`, (_req, res) => {
            response_helper_1.ResponseHelper.success(res, this.listRoutes(), "Route manifest");
        });
    }
    listRoutes() {
        const routes = [];
        function getPrefix(regexp) {
            if (regexp.fast_slash)
                return [];
            const match = regexp
                .toString()
                .replace("\\/?", "")
                .replace("(?=\\/|$)", "$")
                .match(/^\/\^((?:\\[.*+?^${}()|[\]\\\/]|[^.*+?^${}()|[\]\\\/])*)\$\//);
            if (!match)
                return [];
            return match[1].replace(/\\(.)/g, "$1").split("/").filter(Boolean);
        }
        function walk(stack, prefix) {
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
                }
                else if (layer.handle?.stack) {
                    walk(layer.handle.stack, [...prefix, ...getPrefix(layer.regexp)]);
                }
            }
        }
        const router = this.app._router;
        if (router?.stack)
            walk(router.stack, []);
        return routes.sort((a, b) => a.path.localeCompare(b.path));
    }
    // ─── Error handling ──────────────────────────────────────────────────────────
    configureErrorHandling() {
        // Global error handler — must come before 404
        this.app.use(error_middleware_1.errorMiddleware);
        // 404 catch-all — must be last
        this.app.use(error_middleware_1.notFoundMiddleware);
    }
    // ─── Startup sequence ────────────────────────────────────────────────────────
    async start() {
        // 1. Connect to PostgreSQL
        await connection_1.Database.getInstance().connect();
        // 2. Connect Redis (lazy connection — ensure it's ready)
        // await redis.connect();
        // 3. Run idempotent DB seeds
        await initial_seeder_1.InitialSeeder.seed();
        // 4. Initialize email transporter
        mail_service_1.EmailService.initialize();
        // 5. Start BullMQ queue + worker + cron jobs
        await agenda_1.AgendaManager.start();
        // 6. Socket.io will be attached here when the socket module is built:
        // SocketService.attach(this.httpServer);
        // 7. Start listening
        const { port, nodeEnv } = app_config_1.config.server;
        this.httpServer.listen(port, () => {
            asLogger_1.asLogger.info(`GroupSync API listening on port ${port} [${nodeEnv}]`);
        });
        this.httpServer.on("error", (err) => {
            if (err.code === "EADDRINUSE") {
                asLogger_1.asLogger.error(`Port ${port} is already in use`);
            }
            else {
                asLogger_1.asLogger.error("HTTP server error:", err);
            }
            process.exit(1);
        });
    }
}
exports.App = App;
//# sourceMappingURL=app.js.map