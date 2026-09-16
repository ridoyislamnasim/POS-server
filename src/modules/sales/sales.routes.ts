import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { salesController } from "./sales.controller.js";
import { createSaleReturnSchema, createSaleSchema, holdSaleSchema, voidSaleSchema } from "./sales.validation.js";

export const salesRouter = Router();
salesRouter.use(requireAuth, requireTenant);

salesRouter.post("/", requirePermission("sale.create"), validateBody(createSaleSchema), salesController.create);
salesRouter.get("/holds/open", salesController.listOpenHolds);
salesRouter.get("/", requirePermission("sale.view"), salesController.list);
salesRouter.get("/returns", requirePermission("sale.view"), salesController.listReturns);
salesRouter.get("/returns/summary", requirePermission("sale.view"), salesController.returnsSummary);
salesRouter.get("/returns/:id", requirePermission("sale.view"), salesController.getReturn);
salesRouter.post("/returns/:id/approve", salesController.approveReturn);
salesRouter.post("/returns/:id/reject", salesController.rejectReturn);
salesRouter.post("/returns/:id/refund", requirePermission("refund.approve"), salesController.refundReturn);
salesRouter.get("/:id", requirePermission("sale.view"), salesController.getById);
salesRouter.post("/:id/returns", requirePermission("sale.return"), validateBody(createSaleReturnSchema), salesController.createReturn);
salesRouter.post("/:id/void", requirePermission("sale.void"), validateBody(voidSaleSchema), salesController.void);
salesRouter.post("/hold", requirePermission("sale.create"), validateBody(holdSaleSchema), salesController.hold);
salesRouter.delete("/holds/:id", requirePermission("sale.create"), salesController.deleteHold);
