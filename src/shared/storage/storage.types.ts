export interface UploadOptions {
    folder?: string;
    publicId?: string;
    maxBytes?: number;
    transformation?: Record<string, unknown>[];
}

export interface UploadResult {
    url: string;
    publicId: string;
    format: string;
    bytes: number;
    width?: number;
    height?: number;
}

export interface StorageProvider {
    upload(buffer: Buffer, mimeType: string, options?: UploadOptions): Promise<UploadResult>;
    delete(publicId: string): Promise<void>;
}
