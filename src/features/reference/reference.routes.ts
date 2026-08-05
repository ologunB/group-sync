import { Router } from 'express';
import { referenceController } from './reference.controller';

const router = Router();

// Unauthenticated on purpose — these populate the signup form, which runs before the
// user has a token. The payload is static product configuration, not user data.
router.get('/onboarding', referenceController.getOnboardingOptions);
router.get('/interests',  referenceController.getInterests);
router.get('/states',     referenceController.getStates);
router.get('/categories', referenceController.getCategories);

export default router;
