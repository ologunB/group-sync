import { randomUUID } from 'crypto';
import { prisma } from './connection';
import { EncryptionUtil } from '../shared/utils/encryption';
import { config } from '../shared/config/app.config';
import { NOTIFICATION_TYPES } from '../features/notifications/notification.types';
import asLogger from '../shared/utils/asLogger';

// Platform-level notification types that apply globally (no group_id)
const PLATFORM_NOTIF_TYPES = NOTIFICATION_TYPES.filter(
    (t) => t !== 'message' && t !== 'group_announcement',
);

export class InitialSeeder {
    /**
     * Idempotent — safe to run on every startup.
     */
    static async seed(): Promise<void> {
        try {
            await InitialSeeder.seedSuperAdmin();
            asLogger.info('InitialSeeder: completed');
        } catch (error) {
            asLogger.error('InitialSeeder: failed', error);
            throw error;
        }
    }

    // ── Super-admin user ───────────────────────────────────────────────────────

    private static async seedSuperAdmin(): Promise<void> {
        const email = config.seed.adminEmail.toLowerCase();

        const existing = await prisma.user.findUnique({
            where: { email },
            select: { id: true, role: true },
        });

        if (existing) {
            // Ensure the existing account has super_admin role (handles re-seeds after role was added)
            if (existing.role !== 'super_admin') {
                await prisma.user.update({
                    where: { id: existing.id },
                    data: { role: 'super_admin' },
                });
                asLogger.info('InitialSeeder: promoted existing admin account to super_admin', { email });
            }

            await InitialSeeder.seedNotifPreferences(existing.id);
            asLogger.info('InitialSeeder: super_admin already exists, skipped creation', { email });
            return;
        }

        if (config.seed.adminPassword === 'ChangeMe@2025!') {
            asLogger.warn(
                'InitialSeeder: super_admin is being created with the default password. ' +
                'Set ADMIN_PASSWORD in your environment before deploying to production.',
            );
        }

        const passwordHash = await EncryptionUtil.hashPassword(config.seed.adminPassword);
        const userId = randomUUID();

        await prisma.$transaction(async (tx) => {
            await tx.user.create({
                data: {
                    id: userId,
                    email,
                    displayName: config.seed.adminDisplayName,
                    passwordHash,
                    role: 'super_admin',
                    status: 'active',
                    idVerificationStatus: 'verified',
                },
            });
        });

        await InitialSeeder.seedNotifPreferences(userId);

        asLogger.info('InitialSeeder: super_admin created', { email, userId });
    }

    // ── Default notification preferences ──────────────────────────────────────

    private static async seedNotifPreferences(userId: string): Promise<void> {
        // Single query — createMany with skipDuplicates avoids the concurrent-client
        // pg@8 DeprecationWarning that Promise.all over findFirst+create causes.
        await prisma.notificationPreference.createMany({
            data: PLATFORM_NOTIF_TYPES.map((prefType) => ({
                userId, groupId: null, prefType, pushEnabled: true, inAppEnabled: true,
            })),
            skipDuplicates: true,
        });
    }
}
