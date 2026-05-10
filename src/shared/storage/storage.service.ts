import { config } from '../config/app.config';
import { StorageProvider, UploadOptions, UploadResult } from './storage.types';
import { CloudinaryProvider } from './cloudinary.provider';
import { S3Provider } from './s3.provider';

function buildProvider(): StorageProvider {
    switch (config.storage.provider) {
        case 'cloudinary':
            return new CloudinaryProvider();
        case 's3':
            return new S3Provider();
        default:
            throw new Error(`Unknown storage provider: "${config.storage.provider}"`);
    }
}

class StorageServiceClass {
    private readonly provider: StorageProvider = buildProvider();

    upload(buffer: Buffer, mimeType: string, options?: UploadOptions): Promise<UploadResult> {
        return this.provider.upload(buffer, mimeType, options);
    }

    delete(publicId: string): Promise<void> {
        return this.provider.delete(publicId);
    }
}

export const StorageService = new StorageServiceClass();
