"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InitialSeeder = void 0;
const crypto_1 = require("crypto");
const connection_1 = require("./connection");
const encryption_1 = require("../shared/utils/encryption");
const app_config_1 = require("../shared/config/app.config");
const notification_types_1 = require("../features/notifications/notification.types");
const asLogger_1 = __importDefault(require("../shared/utils/asLogger"));
// Platform-level notification types that apply globally (no group_id)
const PLATFORM_NOTIF_TYPES = notification_types_1.NOTIFICATION_TYPES.filter((t) => t !== 'message' && t !== 'group_announcement');
class InitialSeeder {
    /**
     * Idempotent — safe to run on every startup.
     */
    static async seed() {
        try {
            await InitialSeeder.seedSuperAdmin();
            asLogger_1.default.info('InitialSeeder: completed');
        }
        catch (error) {
            asLogger_1.default.error('InitialSeeder: failed', error);
            throw error;
        }
    }
    // ── Super-admin user ───────────────────────────────────────────────────────
    static async seedSuperAdmin() {
        const email = app_config_1.config.seed.adminEmail.toLowerCase();
        const existing = await connection_1.prisma.user.findUnique({
            where: { email },
            select: { id: true, role: true },
        });
        if (existing) {
            // Ensure the existing account has super_admin role (handles re-seeds after role was added)
            if (existing.role !== 'super_admin') {
                await connection_1.prisma.user.update({
                    where: { id: existing.id },
                    data: { role: 'super_admin' },
                });
                asLogger_1.default.info('InitialSeeder: promoted existing admin account to super_admin', { email });
            }
            await InitialSeeder.seedNotifPreferences(existing.id);
            asLogger_1.default.info('InitialSeeder: super_admin already exists, skipped creation', { email });
            return;
        }
        if (app_config_1.config.seed.adminPassword === 'ChangeMe@2025!') {
            asLogger_1.default.warn('InitialSeeder: super_admin is being created with the default password. ' +
                'Set ADMIN_PASSWORD in your environment before deploying to production.');
        }
        const passwordHash = await encryption_1.EncryptionUtil.hashPassword(app_config_1.config.seed.adminPassword);
        const userId = (0, crypto_1.randomUUID)();
        await connection_1.prisma.$transaction(async (tx) => {
            await tx.user.create({
                data: {
                    id: userId,
                    email,
                    displayName: app_config_1.config.seed.adminDisplayName,
                    passwordHash,
                    role: 'super_admin',
                    status: 'active',
                    idVerificationStatus: 'verified',
                },
            });
        });
        await InitialSeeder.seedNotifPreferences(userId);
        asLogger_1.default.info('InitialSeeder: super_admin created', { email, userId });
    }
    // ── Default notification preferences ──────────────────────────────────────
    static async seedNotifPreferences(userId) {
        // Single query — createMany with skipDuplicates avoids the concurrent-client
        // pg@8 DeprecationWarning that Promise.all over findFirst+create causes.
        await connection_1.prisma.notificationPreference.createMany({
            data: PLATFORM_NOTIF_TYPES.map((prefType) => ({
                userId, groupId: null, prefType, pushEnabled: true, inAppEnabled: true,
            })),
            skipDuplicates: true,
        });
    }
}
exports.InitialSeeder = InitialSeeder;
//# sourceMappingURL=initial.seeder.js.map