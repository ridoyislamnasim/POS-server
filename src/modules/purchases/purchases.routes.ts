import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { purchasesController } from "./purchases.controller.js";
import {
  createOrderSchema,
  createPurchaseReturnSchema,
  receivePurchaseSchema,
} from "./purchases.validation.js";

export const purchasesRouter = Router();
purchasesRouter.use(requireAuth, requireTenant);

purchasesRouter.get("/", requirePermission("purchase.view"), purchasesController.list);
purchasesRouter.get("/orders", requirePermission("purchase.view"), purchasesController.listOrders);
purchasesRouter.get("/orders/:id", requirePermission("purchase.view"), purchasesController.getOrder);
purchasesRouter.post("/orders", requirePermission("purchase.manage"), validateBody(createOrderSchema), purchasesController.createOrder);
purchasesRouter.post("/orders/:id/cancel", requirePermission("purchase.manage"), purchasesController.cancelOrder);
purchasesRouter.post("/", requirePermission("purchase.manage"), validateBody(receivePurchaseSchema), purchasesController.receive);
purchasesRouter.get("/returns", requirePermission("purchase.view"), purchasesController.listReturns);
purchasesRouter.get("/:id", requirePermission("purchase.view"), purchasesController.getById);
purchasesRouter.post("/:id/returns", requirePermission("purchase.manage"), validateBody(createPurchaseReturnSchema), purchasesController.createReturn);
