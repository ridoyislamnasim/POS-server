import { Router } from "express";
import { requireAuth, requirePermission, requirePlatform } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { planController } from "./plan.controller.js";
import {
  createPlanSchema,
  setPlanFeaturesSchema,
  setPlanLimitsSchema,
  updatePlanSchema,
} from "./plan.validation.js";

export const planRouter = Router();
planRouter.use(requireAuth, requirePlatform, requirePermission("plan.manage"));

// NOTE: route order is preserved exactly (including /comparison after /:id).
planRouter.get("/", planController.list);
planRouter.post("/", validateBody(createPlanSchema), planController.create);
planRouter.patch("/:id", validateBody(updatePlanSchema), planController.update);
planRouter.get("/comparison", planController.comparison);
planRouter.get("/:id", planController.getById);
planRouter.get("/:id/limits", planController.listLimits);
planRouter.patch("/:id/limits", validateBody(setPlanLimitsSchema), planController.setLimits);
planRouter.get("/:id/features", planController.listFeatures);
planRouter.patch("/:id/features", validateBody(setPlanFeaturesSchema), planController.setFeatures);
