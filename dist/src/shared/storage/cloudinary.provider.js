"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudinaryProvider = void 0;
const cloudinary_1 = require("cloudinary");
const app_config_1 = require("../config/app.config");
class CloudinaryProvider {
    constructor() {
        cloudinary_1.v2.config({
            cloud_name: app_config_1.config.storage.cloudName,
            api_key: app_config_1.config.storage.apiKey,
            api_secret: app_config_1.config.storage.apiSecret,
        });
    }
    upload(buffer, _mimeType, options = {}) {
        const isAudio = options.resourceType === 'audio';
        return new Promise((resolve, reject) => {
            const stream = cloudinary_1.v2.uploader.upload_stream({
                folder: options.folder,
                public_id: options.publicId,
                resource_type: isAudio ? 'video' : 'image', // Cloudinary uses 'video' for audio
                allowed_formats: isAudio ? undefined : ['jpg', 'jpeg', 'png', 'webp'],
                // Transcode to mp3 synchronously — eager with async:false blocks until
                // conversion is done so secure_url already points to the .mp3 file.
                eager: isAudio ? [{ format: 'mp3' }] : undefined,
                eager_async: isAudio ? false : undefined,
                transformation: isAudio ? undefined : (options.transformation ?? [
                    { quality: 'auto', fetch_format: 'auto' },
                ]),
                overwrite: true,
            }, (error, result) => {
                if (error || !result)
                    return reject(error ?? new Error('Cloudinary upload failed'));
                // For audio uploads, use the eager-transformed mp3 URL
                const url = result.eager?.[0]?.secure_url ?? result.secure_url;
                resolve({
                    url,
                    publicId: result.public_id,
                    format: result.format,
                    bytes: result.bytes,
                    width: result.width,
                    height: result.height,
                });
            });
            stream.end(buffer);
        });
    }
    async delete(publicId) {
        await cloudinary_1.v2.uploader.destroy(publicId);
    }
}
exports.CloudinaryProvider = CloudinaryProvider;
//# sourceMappingURL=cloudinary.provider.js.map