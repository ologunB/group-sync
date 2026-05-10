import { Router } from 'express';
import { authenticate } from '../../shared/middleware/auth.middleware';
import { validateRequest } from '../../shared/utils/validators';
import { reportController } from './report.controller';
import { submitReportValidator } from './report.validator';

const router = Router();

router.post('/', authenticate, validateRequest(submitReportValidator), reportController.submitReport);

export default router;
