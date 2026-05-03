// Register process-level handlers FIRST — before any other imports
process.on('uncaughtException', async (error: Error) => {
    console.error('[uncaughtException]', error.message, error.stack);
    await shutdownGracefully(1);
});

process.on('unhandledRejection', async (reason: unknown) => {
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

import { App } from './app';
import { AgendaManager } from './agenda';
import { Database, redis } from './database/connection';

async function shutdownGracefully(code: number): Promise<never> {
    try {
        await AgendaManager.stop();
        await Database.getInstance().disconnect();
        await redis.quit();
    } catch (err) {
        console.error('Error during shutdown:', err);
    }
    process.exit(code);
}

async function bootstrap(): Promise<void> {
    const application = new App();
    await application.start();
}

bootstrap().catch((error) => {
    console.error('Fatal: failed to start GroupSync API', error);
    process.exit(1);
});
