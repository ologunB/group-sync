import dotenv from 'dotenv';
dotenv.config();

function require_env(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

function optional_env(key: string, fallback: string): string {
    return process.env[key] ?? fallback;
}

// SERVICE_MODE controls what this process serves:
//   'api'    — REST API only (no Socket.io)
//   'socket' — Socket.io only (no REST routes)
//   'both'   — full server (default, for monolith / local dev)
export type ServiceMode = 'api' | 'socket' | 'both';

export const config = {
    server: {
        port: parseInt(optional_env('PORT', '3000'), 10),
        nodeEnv: optional_env('NODE_ENV', 'development'),
        apiPrefix: optional_env('API_PREFIX', '/api/v1'),
        corsOrigins: optional_env('CORS_ORIGIN', 'http://localhost:3000').split(',').map((s) => s.trim()),
        clientUrl: optional_env('CLIENT_URL', 'http://localhost:3000'),
        isProduction: optional_env('NODE_ENV', 'development') === 'production',
        serviceMode: optional_env('SERVICE_MODE', 'both') as ServiceMode,
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
        provider:  optional_env('STORAGE_PROVIDER', 'cloudinary') as 'cloudinary' | 's3',
        cloudName: optional_env('CLOUDINARY_CLOUD_NAME', ''),
        apiKey:    optional_env('CLOUDINARY_API_KEY', ''),
        apiSecret: optional_env('CLOUDINARY_API_SECRET', ''),
    },

    s3: {
        accessKeyId:     optional_env('AWS_ACCESS_KEY_ID', ''),
        secretAccessKey: optional_env('AWS_SECRET_ACCESS_KEY', ''),
        region:          optional_env('AWS_REGION', 'us-east-1'),
        bucketName:      optional_env('S3_BUCKET_NAME', ''),
    },

    email: {
        host: optional_env('SMTP_HOST', 'smtp.gmail.com'),
        port: parseInt(optional_env('SMTP_PORT', '465'), 10),
        user: optional_env('SMTP_USER', ''),
        pass: optional_env('SMTP_PASS', ''),
        from: optional_env('EMAIL_FROM', 'GroupSync <noreply@groupsync.app>'),
        // Second Gmail account — kicks in if primary fails
        fallbackUser: optional_env('SMTP_FALLBACK_USER', ''),
        fallbackPass: optional_env('SMTP_FALLBACK_PASS', ''),
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
        adminEmail:       optional_env('ADMIN_EMAIL',        'admin@groupsync.app'),
        adminPassword:    optional_env('ADMIN_PASSWORD',     'ChangeMe@2025!'),
        adminDisplayName: optional_env('ADMIN_DISPLAY_NAME', 'Super Admin'),
    },

    oauth: {
        googleClientId: optional_env('GOOGLE_CLIENT_ID', ''),
    },
} as const;
