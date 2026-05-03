import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { config } from '../config/app.config';
import { TokenPayload } from '../types/common.types';

const SALT_ROUNDS = 10;

export interface EncryptedField {
    ciphertext: string;
    iv: string;
}

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
}

export class EncryptionUtil {
    // ─── Password ───────────────────────────────────────────────────────────────

    static async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, SALT_ROUNDS);
    }

    static async comparePassword(password: string, hash: string): Promise<boolean> {
        return bcrypt.compare(password, hash);
    }

    static generatePassword(length = 16): string {
        return crypto
            .randomBytes(Math.ceil(length / 2))
            .toString('hex')
            .slice(0, length);
    }

    // ─── Random tokens ──────────────────────────────────────────────────────────

    static generateRandomToken(byteLength = 32): string {
        return crypto.randomBytes(byteLength).toString('hex');
    }

    static generateOTP(): string {
        // 6-digit numeric OTP, zero-padded
        return String(crypto.randomInt(100_000, 999_999));
    }

    // ─── JWT ────────────────────────────────────────────────────────────────────

    static generateJWT(payload: TokenPayload, expiresInSeconds: number): string {
        return jwt.sign(payload, config.jwt.secret, {
            expiresIn: expiresInSeconds,
            issuer: 'groupsync',
        });
    }

    static verifyJWT(token: string): TokenPayload {
        return jwt.verify(token, config.jwt.secret, {
            issuer: 'groupsync',
        }) as TokenPayload;
    }

    /**
     * Generates an access token (JWT, 15 min) and an opaque refresh token (hex, 30 days).
     * The refresh token must be persisted in the DB by the caller.
     */
    static generateTokens(payload: TokenPayload, _ipAddress?: string): TokenPair {
        const accessToken = EncryptionUtil.generateJWT(payload, config.jwt.expiresInSeconds);
        const refreshToken = EncryptionUtil.generateRandomToken(64); // 128-char hex, stored in DB
        return {
            accessToken,
            refreshToken,
            expiresIn: config.jwt.expiresInSeconds,
        };
    }

    // ─── AES-256-CBC field encryption (phone, id_document_url) ─────────────────

    static encryptField(plaintext: string): EncryptedField {
        const key = Buffer.from(config.encryption.key, 'hex');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(config.encryption.algorithm, key, iv);

        let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
        ciphertext += cipher.final('hex');

        return { ciphertext, iv: iv.toString('hex') };
    }

    static decryptField(ciphertext: string, iv: string): string {
        const key = Buffer.from(config.encryption.key, 'hex');
        const ivBuffer = Buffer.from(iv, 'hex');
        const decipher = crypto.createDecipheriv(config.encryption.algorithm, key, ivBuffer);

        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    // ─── HMAC verification (KYC webhooks) ───────────────────────────────────────

    static verifyHmacSignature(payload: string, signature: string, secret: string): boolean {
        const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        const expectedBuffer = Buffer.from(`sha256=${expected}`);
        const signatureBuffer = Buffer.from(signature);

        if (expectedBuffer.length !== signatureBuffer.length) return false;
        return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
    }
}
