"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const resend_1 = require("resend");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const app_config_1 = require("../config/app.config");
const asLogger_1 = require("../utils/asLogger");
class EmailService {
    static client;
    static initialized = false;
    static templateCache = new Map();
    static initialize() {
        if (EmailService.initialized)
            return;
        if (!app_config_1.config.email.resendApiKey) {
            asLogger_1.asLogger.warn('EmailService: RESEND_API_KEY not set — emails will not be sent');
        }
        EmailService.client = new resend_1.Resend(app_config_1.config.email.resendApiKey);
        EmailService.initialized = true;
        asLogger_1.asLogger.info('EmailService initialized (Resend)');
    }
    static async send(options) {
        if (!EmailService.initialized) {
            throw new Error('EmailService.initialize() must be called before sending emails.');
        }
        const html = EmailService.renderTemplate(options.template, options.data);
        const { error } = await EmailService.client.emails.send({
            from: app_config_1.config.email.from,
            to: options.to,
            subject: options.subject,
            html,
        });
        if (error) {
            asLogger_1.asLogger.error('Resend email failed', { to: options.to, template: options.template, error: error.message });
            throw new Error(error.message);
        }
        asLogger_1.asLogger.info('Email sent via Resend', { to: options.to, template: options.template });
    }
    // ─── Template rendering ────────────────────────────────────────────────────
    static loadTemplate(name) {
        if (EmailService.templateCache.has(name)) {
            return EmailService.templateCache.get(name);
        }
        const filePath = path_1.default.join(process.cwd(), 'templates', 'emails', `${name}.html`);
        try {
            const html = fs_1.default.readFileSync(filePath, 'utf-8');
            if (app_config_1.config.server.isProduction) {
                EmailService.templateCache.set(name, html);
            }
            return html;
        }
        catch {
            asLogger_1.asLogger.warn(`Email template not found: ${name}.html — using plaintext fallback`);
            return `<p>Notification: ${name}</p><pre>${JSON.stringify({}, null, 2)}</pre>`;
        }
    }
    static renderTemplate(name, data) {
        let html = EmailService.loadTemplate(name);
        // {{data.nested.key}}
        html = html.replace(/\{\{data\.([^}]+)}}/g, (_m, keyPath) => {
            const value = keyPath.trim().split('.').reduce((obj, key) => {
                if (obj !== null && typeof obj === 'object')
                    return obj[key];
                return undefined;
            }, data);
            return value != null ? String(value) : '';
        });
        // {{key}}
        html = html.replace(/\{\{([^}]+)}}/g, (_m, key) => {
            const value = data[key.trim()];
            return value != null ? String(value) : '';
        });
        return html;
    }
}
exports.EmailService = EmailService;
//# sourceMappingURL=mail.service.js.map