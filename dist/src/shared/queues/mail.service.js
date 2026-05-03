"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmailService = void 0;
const nodemailer_1 = __importDefault(require("nodemailer"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const app_config_1 = require("../config/app.config");
const asLogger_1 = require("../utils/asLogger");
// ─── EmailService ─────────────────────────────────────────────────────────────
class EmailService {
    static transporter;
    static initialized = false;
    static templateCache = new Map();
    static initialize() {
        if (EmailService.initialized)
            return;
        EmailService.transporter = nodemailer_1.default.createTransport({
            host: app_config_1.config.email.host,
            port: app_config_1.config.email.port,
            secure: app_config_1.config.email.port === 465,
            auth: {
                user: app_config_1.config.email.user,
                pass: app_config_1.config.email.pass,
            },
        });
        EmailService.initialized = true;
        asLogger_1.asLogger.info('EmailService initialized');
    }
    /**
     * Send an email using an HTML template stored in templates/emails/{template}.html.
     * Template variables use {{data.fieldName}} or {{fieldName}} syntax.
     */
    static async send(options) {
        if (!EmailService.initialized) {
            throw new Error('EmailService.initialize() must be called before sending emails.');
        }
        const html = EmailService.renderTemplate(options.template, options.data);
        await EmailService.transporter.sendMail({
            from: app_config_1.config.email.from,
            to: options.to,
            subject: options.subject,
            html,
        });
        asLogger_1.asLogger.info(`Email sent`, { to: options.to, template: options.template });
    }
    // ─── Template rendering ────────────────────────────────────────────────────
    static loadTemplate(templateName) {
        if (EmailService.templateCache.has(templateName)) {
            return EmailService.templateCache.get(templateName);
        }
        const templatePath = path_1.default.join(process.cwd(), 'templates', 'emails', `${templateName}.html`);
        try {
            const html = fs_1.default.readFileSync(templatePath, 'utf-8');
            // Cache in production only
            if (app_config_1.config.server.isProduction) {
                EmailService.templateCache.set(templateName, html);
            }
            return html;
        }
        catch {
            asLogger_1.asLogger.warn(`Email template not found: ${templateName}.html — using plaintext fallback`);
            return `<p>Notification: ${templateName}</p><pre>${JSON.stringify({}, null, 2)}</pre>`;
        }
    }
    static renderTemplate(templateName, data) {
        let html = EmailService.loadTemplate(templateName);
        // Interpolate {{data.nested.key}} — walks the data object
        html = html.replace(/\{\{data\.([^}]+)}}/g, (_match, keyPath) => {
            const value = keyPath
                .trim()
                .split('.')
                .reduce((obj, key) => {
                if (obj !== null && typeof obj === 'object') {
                    return obj[key];
                }
                return undefined;
            }, data);
            return value != null ? String(value) : '';
        });
        // Interpolate top-level {{key}}
        html = html.replace(/\{\{([^}]+)}}/g, (_match, key) => {
            const value = data[key.trim()];
            return value != null ? String(value) : '';
        });
        return html;
    }
}
exports.EmailService = EmailService;
//# sourceMappingURL=mail.service.js.map