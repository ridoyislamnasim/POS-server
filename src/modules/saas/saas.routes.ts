import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { saasController } from "./saas.controller.js";
import { changePlanSchema, createApiKeySchema, createBackupSchema } from "./saas.validation.js";

export const saasRouter = Router();
saasRouter.use(requireAuth, requireTenant);

saasRouter.get("/subscription", requirePermission("plan.manage"), saasController.getSubscription);
saasRouter.post("/subscription", requirePermission("plan.manage"), validateBody(changePlanSchema), saasController.changePlan);
saasRouter.get("/api-keys", requirePermission("integration.manage"), saasController.listApiKeys);
saasRouter.post("/api-keys", requirePermission("integration.manage"), validateBody(createApiKeySchema), saasController.createApiKey);
saasRouter.post("/api-keys/:id/revoke", requirePermission("integration.manage"), saasController.revokeApiKey);
saasRouter.post("/backup", requirePermission("backup.manage"), validateBody(createBackupSchema), saasController.createBackup);
saasRouter.get("/backups", requirePermission("backup.manage"), saasController.listBackups);
saasRouter.get("/backups/:id/download", requirePermission("backup.manage"), saasController.downloadBackup);
