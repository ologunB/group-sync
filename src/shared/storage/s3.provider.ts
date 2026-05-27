import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/app.config';
import { StorageProvider, UploadOptions, UploadResult } from './storage.types';

// Image/audio transformations are not supported on S3 directly.
// Use CloudFront + Lambda@Edge (or switch to Cloudinary) for resize/quality/transcode transforms.

const MIME_TO_EXT: Record<string, string> = {
    // Images
    'image/jpeg':  'jpg',
    'image/jpg':   'jpg',
    'image/png':   'png',
    'image/webp':  'webp',
    // Audio — all stored as mp3 (mirrors Cloudinary eager transcode behaviour)
    'audio/mpeg':  'mp3',
    'audio/mp3':   'mp3',
    'audio/ogg':   'ogg',
    'audio/wav':   'wav',
    'audio/x-wav': 'wav',
    'audio/mp4':   'mp4',
    'audio/m4a':   'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac':   'aac',
    'audio/opus':  'opus',
    'audio/flac':  'flac',
    'audio/webm':  'mp3',  // transcode webm → mp3 on S3 is not automatic; store as mp3 key
    'video/webm':  'mp3',  // Chrome/Edge MediaRecorder audio reported as video/webm
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
        const isAudio   = options.resourceType === 'audio';
        // Audio is stored as mp3 (consistent with Cloudinary eager transcode).
        // S3 does not transcode — the client must send the correct bytes for the target format,
        // or use a Lambda@Edge / MediaConvert pipeline for server-side transcoding.
        const ext       = isAudio ? 'mp3' : (MIME_TO_EXT[mimeType] ?? 'jpg');
        const storedMime = isAudio ? 'audio/mpeg' : mimeType;
        const folder    = options.folder  ? `${options.folder}/` : '';
        const publicId  = options.publicId ?? `file-${Date.now()}`;
        const key       = `${folder}${publicId}.${ext}`;

        await this.client.send(new PutObjectCommand({
            Bucket:      this.bucket,
            Key:         key,
            Body:        buffer,
            ContentType: storedMime,
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
