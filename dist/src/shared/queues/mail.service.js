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
class EmailService {
    static primary;
    static fallback = null;
    static initialized = false;
    static templateCache = new Map();
    static initialize() {
        if (EmailService.initialized)
            return;
        EmailService.primary = nodemailer_1.default.createTransport({
            host: app_config_1.config.email.host,
            port: app_config_1.config.email.port,
            secure: app_config_1.config.email.port === 465,
            auth: { user: app_config_1.config.email.user, pass: app_config_1.config.email.pass },
            family: 4,
        });
        if (app_config_1.config.email.fallbackUser && app_config_1.config.email.fallbackPass) {
            EmailService.fallback = nodemailer_1.default.createTransport({
                host: 'smtp.gmail.com',
                port: 465,
                secure: true,
                auth: { user: app_config_1.config.email.fallbackUser, pass: app_config_1.config.email.fallbackPass },
                family: 4,
            });
            asLogger_1.asLogger.info('EmailService: Gmail fallback transporter configured');
        }
        EmailService.initialized = true;
        asLogger_1.asLogger.info('EmailService initialized');
    }
    static async send(options) {
        if (!EmailService.initialized) {
            throw new Error('EmailService.initialize() must be called before sending emails.');
        }
        const html = EmailService.renderTemplate(options.template, options.data);
        const mail = { from: app_config_1.config.email.from, to: options.to, subject: options.subject, html };
        try {
            await EmailService.primary.sendMail(mail);
            asLogger_1.asLogger.info('Email sent via primary SMTP', { to: options.to, template: options.template });
        }
        catch (primaryErr) {
            asLogger_1.asLogger.warn('Primary SMTP failed — trying fallback', {
                error: primaryErr?.message,
                template: options.template,
            });
            if (EmailService.fallback) {
                await EmailService.fallback.sendMail(mail);
                asLogger_1.asLogger.info('Email sent via fallback SMTP', { to: options.to, template: options.template });
            }
            else {
                asLogger_1.asLogger.error('No fallback SMTP configured — email not sent', {
                    to: options.to, template: options.template,
                });
                throw primaryErr;
            }
        }
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