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
        return new Promise((resolve, reject) => {
            const stream = cloudinary_1.v2.uploader.upload_stream({
                folder: options.folder,
                public_id: options.publicId,
                resource_type: 'image',
                allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
                transformation: options.transformation ?? [
                    { quality: 'auto', fetch_format: 'auto' },
                ],
                overwrite: true,
            }, (error, result) => {
                if (error || !result)
                    return reject(error ?? new Error('Cloudinary upload failed'));
                resolve({
                    url: result.secure_url,
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