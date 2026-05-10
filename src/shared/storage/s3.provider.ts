import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/app.config';
import { StorageProvider, UploadOptions, UploadResult } from './storage.types';

// Image transformations are not supported on S3 directly.
// Use CloudFront + Lambda@Edge (or switch to Cloudinary) for resize/quality transforms.

const MIME_TO_EXT: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg':  'jpg',
    'image/png':  'png',
    'image/webp': 'webp',
};

export class S3Provider implements StorageProvider {
    private readonly client: S3Client;
    private readonly bucket: string;
    private readonly region: string;

    constructor() {
        this.region = config.s3.region;
        this.bucket = config.s3.bucketName;

        this.client = new S3Client({
            region: this.region,
            credentials: {
                accessKeyId:     config.s3.accessKeyId,
                secretAccessKey: config.s3.secretAccessKey,
            },
        });
    }

    async upload(buffer: Buffer, mimeType: string, options: UploadOptions = {}): Promise<UploadResult> {
        const ext = MIME_TO_EXT[mimeType] ?? 'jpg';
        const folder    = options.folder  ? `${options.folder}/` : '';
        const publicId  = options.publicId ?? `file-${Date.now()}`;
        const key       = `${folder}${publicId}.${ext}`;

        await this.client.send(new PutObjectCommand({
            Bucket:      this.bucket,
            Key:         key,
            Body:        buffer,
            ContentType: mimeType,
            // Objects are public-read by default; adjust ACL if your bucket policy differs.
            ACL:         'public-read' as any,
        }));

        const url = `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;

        return {
            url,
            publicId: key,   // full key is the stable ID used for deletion
            format:   ext,
            bytes:    buffer.byteLength,
        };
    }

    async delete(publicId: string): Promise<void> {
        await this.client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key:    publicId,
        }));
    }
}
