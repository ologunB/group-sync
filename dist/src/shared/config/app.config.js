"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function require_env(key) {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}
function optional_env(key, fallback) {
    return process.env[key] ?? fallback;
}
exports.config = {
    server: {
        port: parseInt(optional_env('PORT', '3000'), 10),
        nodeEnv: optional_env('NODE_ENV', 'development'),
        apiPrefix: optional_env('API_PREFIX', '/api/v1'),
        corsOrigins: optional_env('CORS_ORIGIN', 'http://localhost:3000').split(',').map((s) => s.trim()),
        clientUrl: optional_env('CLIENT_URL', 'http://localhost:3000'),
        isProduction: optional_env('NODE_ENV', 'development') === 'production',
        serviceMode: optional_env('SERVICE_MODE', 'both'),
        testRoutesEnabled: optional_env('TEST_ROUTES_ENABLED', 'false') === 'true',
    },
    database: {
        url: require_env('DATABASE_URL'),
    },
    redis: {
        url: optional_env('REDIS_URL', 'redis://localhost:6379'),
    },
    jwt: {
        secret: require_env('JWT_SECRET'),
        expiresIn: optional_env('JWT_EXPIRES_IN', '15m'),
        expiresInSeconds: 15 * 60, // 15 minutes
        refreshExpiresInMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    },
    encryption: {
        key: require_env('ENCRYPTION_KEY'),
        algorithm: optional_env('ENCRYPTION_ALGORITHM', 'aes-256-cbc'),
    },
    storage: {
        provider: optional_env('STORAGE_PROVIDER', 'cloudinary'),
        cloudName: optional_env('CLOUDINARY_CLOUD_NAME', ''),
        apiKey: optional_env('CLOUDINARY_API_KEY', ''),
        apiSecret: optional_env('CLOUDINARY_API_SECRET', ''),
    },
    s3: {
        accessKeyId: optional_env('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: optional_env('AWS_SECRET_ACCESS_KEY', ''),
        region: optional_env('AWS_REGION', 'us-east-1'),
        bucketName: optional_env('S3_BUCKET_NAME', ''),
    },
    email: {
        resendApiKey: optional_env('RESEND_API_KEY', ''),
        from: optional_env('EMAIL_FROM', 'GroupSync <noreply@groupsync.me>'),
    },
    kyc: {
        apiKey: optional_env('KYC_PROVIDER_API_KEY', ''),
        webhookSecret: optional_env('KYC_WEBHOOK_SECRET', ''),
        enableAutoKyc: optional_env('ENABLE_AUTO_KYC', 'false') === 'true',
    },
    fcm: {
        serverKey: optional_env('FCM_SERVER_KEY', ''),
    },
    seed: {
        adminEmail: optional_env('ADMIN_EMAIL', 'admin@groupsync.app'),
        adminPassword: optional_env('ADMIN_PASSWORD', 'ChangeMe@2025!'),
        adminDisplayName: optional_env('ADMIN_DISPLAY_NAME', 'Super Admin'),
    },
    oauth: {
        googleClientId: optional_env('GOOGLE_CLIENT_ID', ''),
        // Apple issues a different `aud` per surface (iOS bundle ID, web services ID),
        // so every client that may sign in has to be listed.
        appleClientIds: optional_env('APPLE_CLIENT_ID', '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    },
    sms: {
        // 'log' writes the OTP to the application log instead of sending it — the default
        // so phone verification is exercisable before an SMS contract exists.
        provider: optional_env('SMS_PROVIDER', 'log'),
        apiKey: optional_env('SMS_API_KEY', ''),
        senderId: optional_env('SMS_SENDER_ID', 'GroupSync'),
        baseUrl: optional_env('SMS_BASE_URL', 'https://api.ng.termii.com'),
    },
    groups: {
        // Abuse control: a single account may not spin up more than this many groups
        // inside a rolling 7-day window.
        maxCreatesPerWindow: parseInt(optional_env('GROUP_CREATE_MAX_PER_WINDOW', '3'), 10),
        createWindowDays: parseInt(optional_env('GROUP_CREATE_WINDOW_DAYS', '7'), 10),
        // "Active this month" badge: a group counts as active if it has run or scheduled
        // an event whose start time falls inside this many days of now.
        activityWindowDays: parseInt(optional_env('GROUP_ACTIVITY_WINDOW_DAYS', '30'), 10),
    },
};
//# sourceMappingURL=app.config.js.map