"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_middleware_1 = require("../../shared/middleware/auth.middleware");
const validators_1 = require("../../shared/utils/validators");
const report_controller_1 = require("./report.controller");
const report_validator_1 = require("./report.validator");
const router = (0, express_1.Router)();
router.post('/', auth_middleware_1.authenticate, (0, validators_1.validateRequest)(report_validator_1.submitReportValidator), report_controller_1.reportController.submitReport);
exports.default = router;
//# sourceMappingURL=report.routes.js.map