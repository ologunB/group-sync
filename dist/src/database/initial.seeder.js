"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InitialSeeder = void 0;
const asLogger_1 = __importDefault(require("../shared/utils/asLogger"));
class InitialSeeder {
    /**
     * Idempotent — safe to run on every startup.
     * Populates lookup data that must exist for the app to function.
     */
    static async seed() {
        try {
            // Currently no seed data required for the auth module.
            // Add platform admin user creation, default notification preferences, etc. here
            // as additional modules are built.
            asLogger_1.default.info('InitialSeeder: completed (nothing to seed yet)');
        }
        catch (error) {
            asLogger_1.default.error('InitialSeeder: failed', error);
            throw error; // Re-throw — a failed seed should abort startup
        }
    }
}
exports.InitialSeeder = InitialSeeder;
//# sourceMappingURL=initial.seeder.js.map