"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageService = void 0;
const app_config_1 = require("../config/app.config");
const cloudinary_provider_1 = require("./cloudinary.provider");
const s3_provider_1 = require("./s3.provider");
function buildProvider() {
    switch (app_config_1.config.storage.provider) {
        case 'cloudinary':
            return new cloudinary_provider_1.CloudinaryProvider();
        case 's3':
            return new s3_provider_1.S3Provider();
        default:
            throw new Error(`Unknown storage provider: "${app_config_1.config.storage.provider}"`);
    }
}
class StorageServiceClass {
    provider = buildProvider();
    upload(buffer, mimeType, options) {
        return this.provider.upload(buffer, mimeType, options);
    }
    delete(publicId) {
        return this.provider.delete(publicId);
    }
}
exports.StorageService = new StorageServiceClass();
//# sourceMappingURL=storage.service.js.map