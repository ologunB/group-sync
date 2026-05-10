import { Response, NextFunction } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AuthenticatedRequest } from '../../shared/middleware/auth.middleware';
import { ResponseHelper } from '../../shared/utils/response.helper';
import { reportService } from './report.service';
import { SubmitReportDTO } from './report.types';

export class ReportController {
    submitReport = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
        try {
            const dto = req.body as SubmitReportDTO;
            const report = await reportService.submitReport(dto, req.user!);
            ResponseHelper.success(res, report, 'Report submitted successfully.', StatusCodes.CREATED);
        } catch (error) {
            next(error);
        }
    };
}

export const reportController = new ReportController();
