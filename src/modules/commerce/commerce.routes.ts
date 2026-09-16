import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { commerceController } from "./commerce.controller.js";
import {
  createDeliverySchema,
  createEcommerceOrderSchema,
  createSalesOrderSchema,
  updateDeliverySchema,
  updateSalesOrderSchema,
} from "./commerce.validation.js";

export const commerceRouter = Router();
commerceRouter.use(requireAuth, requireTenant);

commerceRouter.get("/sales-orders", requirePermission("order.view"), commerceController.listSalesOrders);
commerceRouter.post("/sales-orders", requirePermission("order.manage"), validateBody(createSalesOrderSchema), commerceController.createSalesOrder);
commerceRouter.patch("/sales-orders/:id", requirePermission("order.manage"), validateBody(updateSalesOrderSchema), commerceController.updateSalesOrder);
commerceRouter.get("/ecommerce", requirePermission("order.view"), commerceController.listEcommerceOrders);
commerceRouter.post("/ecommerce", requirePermission("order.manage"), validateBody(createEcommerceOrderSchema), commerceController.upsertEcommerceOrder);
commerceRouter.delete("/ecommerce/:id", requirePermission("order.manage"), commerceController.deleteEcommerceOrder);
commerceRouter.get("/deliveries", requirePermission("delivery.manage"), commerceController.listDeliveries);
commerceRouter.post("/deliveries", requirePermission("delivery.manage"), validateBody(createDeliverySchema), commerceController.createDelivery);
commerceRouter.patch("/deliveries/:id", requirePermission("delivery.manage"), validateBody(updateDeliverySchema), commerceController.updateDelivery);
commerceRouter.delete("/deliveries/:id", requirePermission("delivery.manage"), commerceController.deleteDelivery);
