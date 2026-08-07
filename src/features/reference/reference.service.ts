import { StatusCodes } from 'http-status-codes';
import { prisma } from '../../database/connection';
import { asLogger } from '../../shared/utils/asLogger';
import { ApiError } from '../../shared/middleware/error.middleware';
import { Messages } from '../../shared/utils/response.constants';
import {
    INTEREST_CATALOG,
    NIGERIA_STATES,
    GROUP_CATEGORIES,
    InterestOption,
    StateOption,
} from './reference.types';

export interface OnboardingOptions {
    interests: InterestOption[];
    interestGroups: string[];
    states: StateOption[];
    categories: string[];
}

/**
 * Serves the signup multi-selects.
 *
 * Interests and categories are rows now, so a platform admin can edit them without a
 * deploy (see AdminService). States stay in code: they are geography, not product
 * taxonomy, and nobody is going to add a 38th Nigerian state from a dashboard.
 *
 * Every read falls back to the module constants if the query fails. These endpoints sit
 * in front of the signup form — a database blip should degrade to a stale-but-correct
 * list rather than an empty picker nobody can complete registration through.
 */
export class ReferenceService {
    async getInterests(): Promise<{ interests: InterestOption[]; groups: string[] }> {
        const interests = await this.loadInterests();
        return {
            interests,
            groups: [...new Set(interests.map((i) => i.group))],
        };
    }

    getStates(): StateOption[] {
        return NIGERIA_STATES;
    }

    async getCategories(): Promise<string[]> {
        return this.loadCategories();
    }

    /** One call for the whole signup form, so onboarding costs a single round-trip. */
    async getOnboardingOptions(): Promise<OnboardingOptions> {
        const [interests, categories] = await Promise.all([
            this.loadInterests(),
            this.loadCategories(),
        ]);

        return {
            interests,
            interestGroups: [...new Set(interests.map((i) => i.group))],
            states: NIGERIA_STATES,
            categories,
        };
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private async loadInterests(): Promise<InterestOption[]> {
        try {
            const rows = await prisma.interest.findMany({
                where: { isActive: true },
                orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
                select: { value: true, label: true, group: true },
            });
            // An empty table means the seed never ran, not that the product has no
            // interests — fall back rather than serve an empty picker.
            return rows.length ? rows : INTEREST_CATALOG;
        } catch (error) {
            asLogger.error('ReferenceService.loadInterests: falling back to constants', error);
            return INTEREST_CATALOG;
        }
    }

    private async loadCategories(): Promise<string[]> {
        try {
            const rows = await prisma.category.findMany({
                where: { isActive: true },
                orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
                select: { value: true },
            });
            return rows.length ? rows.map((r) => r.value) : GROUP_CATEGORIES;
        } catch (error) {
            asLogger.error('ReferenceService.loadCategories: falling back to constants', error);
            return GROUP_CATEGORIES;
        }
    }
}

export const referenceService = new ReferenceService();
