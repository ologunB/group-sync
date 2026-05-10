"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.S3Provider = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const app_config_1 = require("../config/app.config");
// Image transformations are not supported on S3 directly.
// Use CloudFront + Lambda@Edge (or switch to Cloudinary) for resize/quality transforms.
const MIME_TO_EXT = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
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
        const ext = MIME_TO_EXT[mimeType] ?? 'jpg';
        const folder = options.folder ? `${options.folder}/` : '';
        const publicId = options.publicId ?? `file-${Date.now()}`;
        const key = `${folder}${publicId}.${ext}`;
        await this.client.send(new client_s3_1.PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: buffer,
            ContentType: mimeType,
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