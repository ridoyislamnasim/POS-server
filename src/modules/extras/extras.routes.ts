import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { extrasController } from "./extras.controller.js";
import { importCsvSchema } from "./extras.validation.js";
import { notificationRouter } from "../notifications/notification.routes.js";

export const extrasRouter = Router();
extrasRouter.use(requireAuth, requireTenant);

extrasRouter.get("/barcodes/generate", requirePermission("barcode.manage"), extrasController.generateBarcodes);
extrasRouter.post("/import/products", requirePermission("import.manage"), validateBody(importCsvSchema), extrasController.importProducts);
extrasRouter.post("/import/customers", requirePermission("import.manage"), validateBody(importCsvSchema), extrasController.importCustomers);
extrasRouter.use("/notifications", notificationRouter);
extrasRouter.get("/export", requirePermission("import.manage"), extrasController.exportData);
