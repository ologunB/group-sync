"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3Provider = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const app_config_1 = require("../config/app.config");
// Image/audio transformations are not supported on S3 directly.
// Use CloudFront + Lambda@Edge (or switch to Cloudinary) for resize/quality/transcode transforms.
const MIME_TO_EXT = {
    // Images
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    // Audio — all stored as mp3 (mirrors Cloudinary eager transcode behaviour)
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'mp4',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/opus': 'opus',
    'audio/flac': 'flac',
    'audio/webm': 'mp3', // transcode webm → mp3 on S3 is not automatic; store as mp3 key
    'video/webm': 'mp3', // Chrome/Edge MediaRecorder audio reported as video/webm
};
class S3Provider {
    client;
    bucket;
    region;
    constructor() {
        this.region = app_config_1.config.s3.region;
        this.bucket = app_config_1.config.s3.bucketName;
        this.client = new client_s3_1.S3Client({
            region: this.region,
            credentials: {
                accessKeyId: app_config_1.config.s3.accessKeyId,
                secretAccessKey: app_config_1.config.s3.secretAccessKey,
            },
        });
    }
    async upload(buffer, mimeType, options = {}) {
        const isAudio = options.resourceType === 'audio';
        // Audio is stored as mp3 (consistent with Cloudinary eager transcode).
        // S3 does not transcode — the client must send the correct bytes for the target format,
        // or use a Lambda@Edge / MediaConvert pipeline for server-side transcoding.
        const ext = isAudio ? 'mp3' : (MIME_TO_EXT[mimeType] ?? 'jpg');
        const storedMime = isAudio ? 'audio/mpeg' : mimeType;
        const folder = options.folder ? `${options.folder}/` : '';
        const publicId = options.publicId ?? `file-${Date.now()}`;
        const key = `${folder}${publicId}.${ext}`;
        await this.client.send(new client_s3_1.PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: buffer,
            ContentType: storedMime,
            // Objects are public-read by default; adjust ACL if your bucket policy differs.
            ACL: 'public-read',
        }));
        const url = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
        return {
            url,
            publicId: key, // full key is the stable ID used for deletion
            format: ext,
            bytes: buffer.byteLength,
        };
    }
    async delete(publicId) {
        await this.client.send(new client_s3_1.DeleteObjectCommand({
            Bucket: this.bucket,
            Key: publicId,
        }));
    }
}
exports.S3Provider = S3Provider;
//# sourceMappingURL=s3.provider.js.map