"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Register process-level handlers FIRST — before any other imports
process.on('uncaughtException', async (error) => {
    console.error('[uncaughtException]', error.message, error.stack);
    await shutdownGracefully(1);
});
process.on('unhandledRejection', async (reason) => {
    console.error('[unhandledRejection]', reason);
    await shutdownGracefully(1);
});
process.on('SIGTERM', async () => {
    console.info('SIGTERM received — shutting down gracefully');
    await shutdownGracefully(0);
});
process.on('SIGINT', async () => {
    console.info('SIGINT received — shutting down gracefully');
    await shutdownGracefully(0);
});
const app_1 = require("./app");
const agenda_1 = require("./agenda");
const connection_1 = require("./database/connection");
let shuttingDown = false;
async function shutdownGracefully(code) {
    // Guard against concurrent shutdown calls (e.g. multiple unhandledRejections)
    if (shuttingDown) {
        process.exit(code);
    }
    shuttingDown = true;
    try {
        await agenda_1.AgendaManager.stop();
        await connection_1.Database.getInstance().disconnect();
        if (connection_1.redis.status !== 'end') {
            await connection_1.redis.quit().catch(() => { });
        }
    }
    catch (err) {
        console.error('Error during shutdown:', err);
    }
    process.exit(code);
}
async function bootstrap() {
    const application = new app_1.App();
    await application.start();
}
bootstrap().catch((error) => {
    console.error('Fatal: failed to start GroupSync API', error);
    process.exit(1);
});
//# sourceMappingURL=server.js.map