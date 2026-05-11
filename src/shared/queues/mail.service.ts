import nodemailer, { Transporter } from 'nodemailer';
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
    private static primary:  Transporter;
    private static fallback: Transporter | null = null;
    private static initialized = false;
    private static templateCache = new Map<string, string>();

    static initialize(): void {
        if (EmailService.initialized) return;

        EmailService.primary = nodemailer.createTransport({
            host:   config.email.host,
            port:   config.email.port,
            secure: config.email.port === 465,
            auth:   { user: config.email.user, pass: config.email.pass },
        });

        if (config.email.fallbackUser && config.email.fallbackPass) {
            EmailService.fallback = nodemailer.createTransport({
                host:   'smtp.gmail.com',
                port:   465,
                secure: true,
                auth:   { user: config.email.fallbackUser, pass: config.email.fallbackPass },
            });
            asLogger.info('EmailService: Gmail fallback transporter configured');
        }

        EmailService.initialized = true;
        asLogger.info('EmailService initialized');
    }

    static async send(options: EmailOptions): Promise<void> {
        if (!EmailService.initialized) {
            throw new Error('EmailService.initialize() must be called before sending emails.');
        }

        const html = EmailService.renderTemplate(options.template, options.data);
        const mail = { from: config.email.from, to: options.to, subject: options.subject, html };

        try {
            await EmailService.primary.sendMail(mail);
            asLogger.info('Email sent via primary SMTP', { to: options.to, template: options.template });
        } catch (primaryErr: any) {
            asLogger.warn('Primary SMTP failed — trying fallback', {
                error: primaryErr?.message,
                template: options.template,
            });

            if (EmailService.fallback) {
                await EmailService.fallback.sendMail(mail);
                asLogger.info('Email sent via fallback SMTP', { to: options.to, template: options.template });
            } else {
                asLogger.error('No fallback SMTP configured — email not sent', {
                    to: options.to, template: options.template,
                });
                throw primaryErr;
            }
        }
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

        // {{data.nested.key}}
        html = html.replace(/\{\{data\.([^}]+)}}/g, (_m, keyPath: string) => {
            const value = keyPath.trim().split('.').reduce((obj: unknown, key: string) => {
                if (obj !== null && typeof obj === 'object') return (obj as Record<string, unknown>)[key];
                return undefined;
            }, data);
            return value != null ? String(value) : '';
        });

        // {{key}}
        html = html.replace(/\{\{([^}]+)}}/g, (_m, key: string) => {
            const value = data[key.trim()];
            return value != null ? String(value) : '';
        });

        return html;
    }
}
