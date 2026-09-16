import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { tenantAccessController } from "./tenant-access.controller.js";

export const tenantAccessRouter = Router();
tenantAccessRouter.use(requireAuth, requireTenant);

tenantAccessRouter.get("/plan", requirePermission("plan.manage"), tenantAccessController.plan);
tenantAccessRouter.get("/usage", requirePermission("plan.manage"), tenantAccessController.usage);
tenantAccessRouter.get("/usage/monthly", requirePermission("plan.manage"), tenantAccessController.monthlyUsage);
tenantAccessRouter.get("/plans", requirePermission("plan.manage"), tenantAccessController.plans);
tenantAccessRouter.get("/usage/over-limit", requirePermission("plan.manage"), tenantAccessController.overLimit);
