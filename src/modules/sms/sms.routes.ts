import { Router } from "express";
import { requireAuth, requirePermission, requirePlatform, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { smsController } from "./sms.controller.js";
import { sendSmsSchema, setPlatformAccessSchema } from "./sms.validation.js";

export const smsRouter = Router();
smsRouter.use(requireAuth, requireTenant);

smsRouter.get("/dashboard", requirePermission("sms.view"), smsController.dashboard);
smsRouter.get("/settings", requirePermission("sms.settings"), smsController.getSettings);
smsRouter.patch("/settings", requirePermission("sms.settings"), smsController.updateSettings);
smsRouter.get("/templates", smsController.listTemplates);
smsRouter.patch("/templates/:id", requirePermission("sms.settings"), smsController.updateTemplate);
smsRouter.post("/templates/:id/reset", requirePermission("sms.settings"), smsController.resetTemplate);
smsRouter.post("/preview", smsController.preview);
smsRouter.get("/logs", requirePermission("sms.view"), smsController.listLogs);
smsRouter.post("/logs/:id/retry", requirePermission("sms.send"), smsController.retryLog);
smsRouter.post("/send", requirePermission("sms.send"), validateBody(sendSmsSchema), smsController.send);
smsRouter.get("/usage", requirePermission("sms.view"), smsController.usage);
smsRouter.post("/usage/refresh-balance", requirePermission("sms.settings"), smsController.refreshBalance);
smsRouter.patch("/platform-access", requirePlatform, validateBody(setPlatformAccessSchema), smsController.setPlatformAccess);
