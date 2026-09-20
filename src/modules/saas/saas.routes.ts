import { Router } from "express";
import { requireAuth, requirePermission, requirePlatformSuperAdmin, requireTenant } from "../../middleware/auth.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import { saasController } from "./saas.controller.js";
import { changePlanSchema, createApiKeySchema, createBackupSchema, listBackupsSchema } from "./saas.validation.js";

export const saasRouter = Router();
saasRouter.use(requireAuth);

// Tenant self-service stays tenant-scoped + permission-gated.
// Backup is platform-only: PLATFORM_SUPER_ADMIN picks the target tenant
// explicitly, so these routes deliberately skip requireTenant.

saasRouter.get("/subscription", requireTenant, requirePermission("plan.manage"), saasController.getSubscription);
saasRouter.post("/subscription", requireTenant, requirePermission("plan.manage"), validateBody(changePlanSchema), saasController.changePlan);
saasRouter.get("/api-keys", requireTenant, requirePermission("integration.manage"), saasController.listApiKeys);
saasRouter.post("/api-keys", requireTenant, requirePermission("integration.manage"), validateBody(createApiKeySchema), saasController.createApiKey);
saasRouter.post("/api-keys/:id/revoke", requireTenant, requirePermission("integration.manage"), saasController.revokeApiKey);
saasRouter.post("/backup", requirePlatformSuperAdmin, validateBody(createBackupSchema), saasController.createBackup);
saasRouter.get("/backups", requirePlatformSuperAdmin, validateQuery(listBackupsSchema), saasController.listBackups);
saasRouter.get("/backups/:id/download", requirePlatformSuperAdmin, saasController.downloadBackup);
