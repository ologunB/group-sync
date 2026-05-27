import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config/app.config';
import { StorageProvider, UploadOptions, UploadResult } from './storage.types';

export class CloudinaryProvider implements StorageProvider {
    constructor() {
        cloudinary.config({
            cloud_name: config.storage.cloudName,
            api_key:    config.storage.apiKey,
            api_secret: config.storage.apiSecret,
        });
    }

    upload(buffer: Buffer, _mimeType: string, options: UploadOptions = {}): Promise<UploadResult> {
        const isAudio = options.resourceType === 'audio';
        return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder:          options.folder,
                    public_id:       options.publicId,
                    resource_type:   isAudio ? 'video' : 'image', // Cloudinary uses 'video' for audio
                    allowed_formats: isAudio ? undefined : ['jpg', 'jpeg', 'png', 'webp'],
                    // Transcode to mp3 synchronously — eager with async:false blocks until
                    // conversion is done so secure_url already points to the .mp3 file.
                    eager:           isAudio ? [{ format: 'mp3' }] : undefined,
                    eager_async:     isAudio ? false : undefined,
                    transformation:  isAudio ? undefined : (options.transformation ?? [
                        { quality: 'auto', fetch_format: 'auto' },
                    ]),
                    overwrite: true,
                },
                (error, result) => {
                    if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
                    // For audio uploads, use the eager-transformed mp3 URL
                    const url = (result.eager?.[0]?.secure_url as string | undefined) ?? result.secure_url;
                    resolve({
                        url,
                        publicId: result.public_id,
                        format:   result.format,
                        bytes:    result.bytes,
                        width:    result.width,
                        height:   result.height,
                    });
                },
            );
            stream.end(buffer);
        });
    }

    async delete(publicId: string): Promise<void> {
        await cloudinary.uploader.destroy(publicId);
    }
}
