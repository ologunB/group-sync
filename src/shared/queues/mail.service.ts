import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { config } from '../config/app.config';
import { asLogger } from '../utils/asLogger';

export interface EmailOptions {
    to: string;
    subject: string;
    template: string;
    data: Record<string, unknown>;
}

export class EmailService {
    private static client: Resend;
    private static initialized = false;
    private static templateCache = new Map<string, string>();

    static initialize(): void {
        if (EmailService.initialized) return;

        if (!config.email.resendApiKey) {
            asLogger.warn('EmailService: RESEND_API_KEY not set — emails will not be sent');
        }

        EmailService.client = new Resend(config.email.resendApiKey);
        EmailService.initialized = true;
        asLogger.info('EmailService initialized (Resend)');
    }

    static async send(options: EmailOptions): Promise<void> {
        if (!EmailService.initialized) {
            throw new Error('EmailService.initialize() must be called before sending emails.');
        }

        const html = EmailService.renderTemplate(options.template, options.data);

        const { error } = await EmailService.client.emails.send({
            from:    config.email.from,
            to:      options.to,
            subject: options.subject,
            html,
        });

        if (error) {
            asLogger.error('Resend email failed', { to: options.to, template: options.template, error: error.message });
            throw new Error(error.message);
        }

        asLogger.info('Email sent via Resend', { to: options.to, template: options.template });
    }

    // ─── Template rendering ────────────────────────────────────────────────────

    private static loadTemplate(name: string): string {
        if (EmailService.templateCache.has(name)) {
            return EmailService.templateCache.get(name)!;
        }

        const filePath = path.join(process.cwd(), 'templates', 'emails', `${name}.html`);

        try {
            const html = fs.readFileSync(filePath, 'utf-8');
            if (config.server.isProduction) {
                EmailService.templateCache.set(name, html);
            }
            return html;
        } catch {
            asLogger.warn(`Email template not found: ${name}.html — using plaintext fallback`);
            return `<p>Notification: ${name}</p><pre>${JSON.stringify({}, null, 2)}</pre>`;
        }
    }

    private static renderTemplate(name: string, data: Record<string, unknown>): string {
        let html = EmailService.loadTemplate(name);
        const templateData: Record<string, unknown> = {
            ...data,
            currentYear: new Date().getFullYear(),
        };

        // {{data.nested.key}}
        html = html.replace(/\{\{data\.([^}]+)}}/g, (_m, keyPath: string) => {
            const value = keyPath.trim().split('.').reduce((obj: unknown, key: string) => {
                if (obj !== null && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
                return undefined;
            }, templateData);
            return value != null ? String(value) : '';
        });

        // {{key}}
        html = html.replace(/\{\{([^}]+)}}/g, (_m, key: string) => {
            const value = templateData[key.trim()];
            return value != null ? String(value) : '';
        });

        return html;
    }
}
