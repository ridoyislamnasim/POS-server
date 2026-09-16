import { Router } from "express";
import { requireAuth, requirePermission, requirePlatform, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import {
  platformOverrideController,
  platformRequestController,
  tenantRequestController,
} from "./access-request.controller.js";
import {
  approveAccessRequestSchema,
  createAccessRequestSchema,
  createFeatureOverrideSchema,
  createLimitOverrideSchema,
  rejectAccessRequestSchema,
  revokeOverrideSchema,
} from "./access-request.validation.js";

export const tenantRequestRouter = Router();
tenantRequestRouter.use(requireAuth, requireTenant);

tenantRequestRouter.post("/", requirePermission("tenant.access_request.create"), validateBody(createAccessRequestSchema), tenantRequestController.create);
tenantRequestRouter.get("/", requirePermission("tenant.access_request.create"), tenantRequestController.list);
tenantRequestRouter.post("/:id/cancel", requirePermission("tenant.access_request.cancel"), tenantRequestController.cancel);

export const platformRequestRouter = Router();
platformRequestRouter.use(requireAuth, requirePlatform, requirePermission("plan.manage"));

platformRequestRouter.get("/", platformRequestController.list);
platformRequestRouter.get("/:id", platformRequestController.getById);
platformRequestRouter.post("/:id/approve", validateBody(approveAccessRequestSchema), platformRequestController.approve);
platformRequestRouter.post("/:id/reject", validateBody(rejectAccessRequestSchema), platformRequestController.reject);

export const platformOverrideRouter = Router();
platformOverrideRouter.use(requireAuth, requirePlatform, requirePermission("plan.manage"));

platformOverrideRouter.get("/", platformOverrideController.list);
platformOverrideRouter.post("/limit", validateBody(createLimitOverrideSchema), platformOverrideController.createLimit);
platformOverrideRouter.post("/feature", validateBody(createFeatureOverrideSchema), platformOverrideController.createFeature);
platformOverrideRouter.patch("/:id/revoke", validateBody(revokeOverrideSchema), platformOverrideController.revoke);
