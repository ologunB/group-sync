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
 * Serves the signup multi-selects. No DB access and no per-request work — the catalogues
 * are module constants, so this is effectively a typed constant with a route in front.
 */
export class ReferenceService {
    getInterests(): { interests: InterestOption[]; groups: string[] } {
        return {
            interests: INTEREST_CATALOG,
            groups: [...new Set(INTEREST_CATALOG.map((i) => i.group))],
        };
    }

    getStates(): StateOption[] {
        return NIGERIA_STATES;
    }

    getCategories(): string[] {
        return GROUP_CATEGORIES;
    }

    /** One call for the whole signup form, so onboarding costs a single round-trip. */
    getOnboardingOptions(): OnboardingOptions {
        return {
            interests: INTEREST_CATALOG,
            interestGroups: [...new Set(INTEREST_CATALOG.map((i) => i.group))],
            states: NIGERIA_STATES,
            categories: GROUP_CATEGORIES,
        };
    }
}

export const referenceService = new ReferenceService();
