"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.asLogger = void 0;
const winston_1 = __importDefault(require("winston"));
const { combine, timestamp, colorize, printf, json, errors } = winston_1.default.format;
const isProduction = process.env.NODE_ENV === 'production';
const consoleFormat = printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? `\n${JSON.stringify(meta, null, 2)}` : '';
    const stackStr = stack ? `\n${stack}` : '';
    return `${ts} [${level}]: ${message}${metaStr}${stackStr}`;
});
const transports = [
    new winston_1.default.transports.Console({
        format: isProduction
            ? combine(timestamp(), errors({ stack: true }), json())
            : combine(colorize({ all: true }), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), errors({ stack: true }), consoleFormat),
    }),
];
if (isProduction) {
    transports.push(new winston_1.default.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        format: combine(timestamp(), errors({ stack: true }), json()),
    }), new winston_1.default.transports.File({
        filename: 'logs/combined.log',
        format: combine(timestamp(), errors({ stack: true }), json()),
    }));
}
exports.asLogger = winston_1.default.createLogger({
    level: isProduction ? 'info' : 'debug',
    format: combine(timestamp(), errors({ stack: true }), json()),
    transports,
    exitOnError: false,
});
exports.default = exports.asLogger;
//# sourceMappingURL=asLogger.js.map