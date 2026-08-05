import { Request, Response, NextFunction } from 'express';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { referenceService } from './reference.service';

export class ReferenceController {
    // ─── GET /reference/onboarding ─────────────────────────────────────────────

    getOnboardingOptions = async (
        _req: Request,
        res: Response,
        next: NextFunction,
    ): Promise<void> => {
        try {
            ResponseHelper.success(res, referenceService.getOnboardingOptions());
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /reference/interests ──────────────────────────────────────────────

    getInterests = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            ResponseHelper.success(res, referenceService.getInterests());
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /reference/states ─────────────────────────────────────────────────

    getStates = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            ResponseHelper.success(res, referenceService.getStates());
        } catch (error) {
            next(error);
        }
    };

    // ─── GET /reference/categories ─────────────────────────────────────────────

    getCategories = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            ResponseHelper.success(res, referenceService.getCategories());
        } catch (error) {
            next(error);
        }
    };
}

export const referenceController = new ReferenceController();
