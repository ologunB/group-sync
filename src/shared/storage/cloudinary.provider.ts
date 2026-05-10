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
        return new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder:          options.folder,
                    public_id:       options.publicId,
                    resource_type:   'image',
                    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
                    transformation:  options.transformation ?? [
                        { quality: 'auto', fetch_format: 'auto' },
                    ],
                    overwrite: true,
                },
                (error, result) => {
                    if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'));
                    resolve({
                        url:      result.secure_url,
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
