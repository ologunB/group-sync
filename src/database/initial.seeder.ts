import asLogger from "../shared/utils/asLogger";

export class InitialSeeder {
    /**
     * Idempotent — safe to run on every startup.
     * Populates lookup data that must exist for the app to function.
     */
    static async seed(): Promise<void> {
        try {
            // Currently no seed data required for the auth module.
            // Add platform admin user creation, default notification preferences, etc. here
            // as additional modules are built.
            asLogger.info('InitialSeeder: completed (nothing to seed yet)');
        } catch (error) {
            asLogger.error('InitialSeeder: failed', error);
            throw error; // Re-throw — a failed seed should abort startup
        }
    }
}
