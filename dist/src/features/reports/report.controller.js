"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportController = exports.ReportController = void 0;
const http_status_codes_1 = require("http-status-codes");
const response_helper_1 = require("../../shared/utils/response.helper");
const report_service_1 = require("./report.service");
class ReportController {
    submitReport = async (req, res, next) => {
        try {
            const dto = req.body;
            const report = await report_service_1.reportService.submitReport(dto, req.user);
            response_helper_1.ResponseHelper.success(res, report, 'Report submitted successfully.', http_status_codes_1.StatusCodes.CREATED);
        }
        catch (error) {
            next(error);
        }
    };
}
exports.ReportController = ReportController;
exports.reportController = new ReportController();
//# sourceMappingURL=report.controller.js.map