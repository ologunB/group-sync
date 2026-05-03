import nodemailer, { Transporter } from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { config } from '../config/app.config';
import { asLogger } from '../utils/asLogger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailOptions {
    to: string;
    subject: string;
    template: string;                  // filename without .html extension
    data: Record<string, unknown>;     // interpolation context
}

// ─── EmailService ─────────────────────────────────────────────────────────────

export class EmailService {
    private static transporter: Transporter;
    private static initialized = false;
    private static templateCache = new Map<string, string>();

    static initialize(): void {
        if (EmailService.initialized) return;

        EmailService.transporter = nodemailer.createTransport({
            host: config.email.host,
            port: config.email.port,
            secure: config.email.port === 465,
            auth: {
                user: config.email.user,
                pass: config.email.pass,
            },
        });

        EmailService.initialized = true;
        asLogger.info('EmailService initialized');
    }

    /**
     * Send an email using an HTML template stored in templates/emails/{template}.html.
     * Template variables use {{data.fieldName}} or {{fieldName}} syntax.
     */
    static async send(options: EmailOptions): Promise<void> {
        if (!EmailService.initialized) {
            throw new Error('EmailService.initialize() must be called before sending emails.');
        }

        const html = EmailService.renderTemplate(options.template, options.data);

        await EmailService.transporter.sendMail({
            from: config.email.from,
            to: options.to,
            subject: options.subject,
            html,
        });

        asLogger.info(`Email sent`, { to: options.to, template: options.template });
    }

    // ─── Template rendering ────────────────────────────────────────────────────

    private static loadTemplate(templateName: string): string {
        if (EmailService.templateCache.has(templateName)) {
            return EmailService.templateCache.get(templateName)!;
        }

        const templatePath = path.join(
            process.cwd(),
            'templates',
            'emails',
            `${templateName}.html`,
        );

        try {
            const html = fs.readFileSync(templatePath, 'utf-8');
            // Cache in production only
            if (config.server.isProduction) {
                EmailService.templateCache.set(templateName, html);
            }
            return html;
        } catch {
            asLogger.warn(`Email template not found: ${templateName}.html — using plaintext fallback`);
            return `<p>Notification: ${templateName}</p><pre>${JSON.stringify({}, null, 2)}</pre>`;
        }
    }

    private static renderTemplate(
        templateName: string,
        data: Record<string, unknown>,
    ): string {
        let html = EmailService.loadTemplate(templateName);

        // Interpolate {{data.nested.key}} — walks the data object
        html = html.replace(/\{\{data\.([^}]+)\}\}/g, (_match, keyPath: string) => {
            const value = keyPath
                .trim()
                .split('.')
                .reduce((obj: unknown, key: string) => {
                    if (obj !== null && typeof obj === 'object') {
                        return (obj as Record<string, unknown>)[key];
                    }
                    return undefined;
                }, data);
            return value != null ? String(value) : '';
        });

        // Interpolate top-level {{key}}
        html = html.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
            const value = data[key.trim()];
            return value != null ? String(value) : '';
        });

        return html;
    }
}
