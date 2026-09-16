import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { settingsController } from "./settings.controller.js";
import {
  createCurrencySchema,
  createTaxSchema,
  createTemplateSchema,
  updateSettingsSchema,
} from "./settings.validation.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireTenant, requirePermission("settings.manage"));

settingsRouter.get("/", settingsController.get);
settingsRouter.patch("/", validateBody(updateSettingsSchema), settingsController.update);
settingsRouter.post("/tax", validateBody(createTaxSchema), settingsController.createTax);
settingsRouter.post("/templates", validateBody(createTemplateSchema), settingsController.createTemplate);
settingsRouter.get("/currencies", settingsController.listCurrencies);
settingsRouter.post("/currencies", validateBody(createCurrencySchema), settingsController.createCurrency);
