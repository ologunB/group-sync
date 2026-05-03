import winston from 'winston';

const { combine, timestamp, colorize, printf, json, errors } = winston.format;

const isProduction = process.env.NODE_ENV === 'production';

const consoleFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${ts} [${level}]: ${message}${metaStr}${stackStr}`;
});

const transports: winston.transport[] = [
    new winston.transports.Console({
        format: isProduction
            ? combine(timestamp(), errors({ stack: true }), json())
            : combine(
                colorize({ all: true }),
                timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                errors({ stack: true }),
                consoleFormat,
            ),
    }),
];

if (isProduction) {
    transports.push(
        new winston.transports.File({
            filename: 'logs/error.log',
            level: 'error',
            format: combine(timestamp(), errors({ stack: true }), json()),
        }),
        new winston.transports.File({
            filename: 'logs/combined.log',
            format: combine(timestamp(), errors({ stack: true }), json()),
        }),
    );
}

export const asLogger = winston.createLogger({
    level: isProduction ? 'info' : 'debug',
    format: combine(timestamp(), errors({ stack: true }), json()),
    transports,
    exitOnError: false,
});

export default asLogger;
