"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EncryptionUtil = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const app_config_1 = require("../config/app.config");
const SALT_ROUNDS = 10;
class EncryptionUtil {
    // ─── Password ───────────────────────────────────────────────────────────────
    static async hashPassword(password) {
        return bcrypt_1.default.hash(password, SALT_ROUNDS);
    }
    static async comparePassword(password, hash) {
        return bcrypt_1.default.compare(password, hash);
    }
    static generatePassword(length = 16) {
        return crypto_1.default
            .randomBytes(Math.ceil(length / 2))
            .toString('hex')
            .slice(0, length);
    }
    // ─── Random tokens ──────────────────────────────────────────────────────────
    static generateRandomToken(byteLength = 32) {
        return crypto_1.default.randomBytes(byteLength).toString('hex');
    }
    static generateOTP() {
        // 6-digit numeric OTP, zero-padded
        return String(crypto_1.default.randomInt(100_000, 999_999));
    }
    // ─── JWT ────────────────────────────────────────────────────────────────────
    static generateJWT(payload, expiresInSeconds) {
        return jsonwebtoken_1.default.sign(payload, app_config_1.config.jwt.secret, {
            expiresIn: expiresInSeconds,
            issuer: 'groupsync',
        });
    }
    static verifyJWT(token) {
        return jsonwebtoken_1.default.verify(token, app_config_1.config.jwt.secret, {
            issuer: 'groupsync',
        });
    }
    /**
     * Generates an access token (JWT, 15 min) and an opaque refresh token (hex, 30 days).
     * The refresh token must be persisted in the DB by the caller.
     */
    static generateTokens(payload, _ipAddress) {
        const accessToken = EncryptionUtil.generateJWT(payload, app_config_1.config.jwt.expiresInSeconds);
        const refreshToken = EncryptionUtil.generateRandomToken(64); // 128-char hex, stored in DB
        return {
            accessToken,
            refreshToken,
            expiresIn: app_config_1.config.jwt.expiresInSeconds,
        };
    }
    // ─── AES-256-CBC field encryption (phone, id_document_url) ─────────────────
    static encryptField(plaintext) {
        const key = Buffer.from(app_config_1.config.encryption.key, 'hex');
        const iv = crypto_1.default.randomBytes(16);
        const cipher = crypto_1.default.createCipheriv(app_config_1.config.encryption.algorithm, key, iv);
        let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
        ciphertext += cipher.final('hex');
        return { ciphertext, iv: iv.toString('hex') };
    }
    static decryptField(ciphertext, iv) {
        const key = Buffer.from(app_config_1.config.encryption.key, 'hex');
        const ivBuffer = Buffer.from(iv, 'hex');
        const decipher = crypto_1.default.createDecipheriv(app_config_1.config.encryption.algorithm, key, ivBuffer);
        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    // ─── HMAC verification (KYC webhooks) ───────────────────────────────────────
    static verifyHmacSignature(payload, signature, secret) {
        const expected = crypto_1.default.createHmac('sha256', secret).update(payload).digest('hex');
        const expectedBuffer = Buffer.from(`sha256=${expected}`);
        const signatureBuffer = Buffer.from(signature);
        if (expectedBuffer.length !== signatureBuffer.length)
            return false;
        return crypto_1.default.timingSafeEqual(expectedBuffer, signatureBuffer);
    }
}
exports.EncryptionUtil = EncryptionUtil;
//# sourceMappingURL=encryption.js.map