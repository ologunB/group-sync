import { config } from '../config/app.config';
import { asLogger } from '../utils/asLogger';

export interface SmsOptions {
    to: string;
    message: string;
}

/**
 * Outbound SMS. Only used for phone-verification OTPs today.
 *
 * The default provider is 'log', which writes the message to the application log rather
 * than sending it. That is deliberate: phone verification gates joining groups, so the
 * flow has to be exercisable end-to-end before an SMS contract exists. Set
 * SMS_PROVIDER=termii with SMS_API_KEY to send for real.
 */
export class SmsService {
    static async send(options: SmsOptions): Promise<void> {
        switch (config.sms.provider) {
            case 'termii':
                await SmsService.sendViaTermii(options);
                break;

            case 'log':
            default:
                asLogger.warn('SmsService: SMS_PROVIDER=log — message not delivered', {
                    to: SmsService.mask(options.to),
                    message: options.message,
                });
                break;
        }
    }

    private static async sendViaTermii({ to, message }: SmsOptions): Promise<void> {
        if (!config.sms.apiKey) {
            throw new Error('SMS_PROVIDER=termii but SMS_API_KEY is not set');
        }

        const response = await fetch(`${config.sms.baseUrl}/api/sms/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to,
                from: config.sms.senderId,
                sms: message,
                type: 'plain',
                channel: 'generic',
                api_key: config.sms.apiKey,
            }),
        });

        if (!response.ok) {
            const body = await response.text();
            asLogger.error('SmsService: Termii send failed', {
                to: SmsService.mask(to),
                status: response.status,
                body,
            });
            throw new Error(`Termii responded ${response.status}`);
        }

        asLogger.info('SMS sent via Termii', { to: SmsService.mask(to) });
    }

    /** Never log a full phone number — it is encrypted at rest for the same reason. */
    private static mask(phone: string): string {
        return phone.length <= 4 ? '****' : `${'*'.repeat(phone.length - 4)}${phone.slice(-4)}`;
    }
}
