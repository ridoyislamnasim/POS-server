import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { customersController } from "./customers.controller.js";
import {
  adjustLoyaltySchema,
  createCustomerSchema,
  updateCustomerSchema,
} from "./customers.validation.js";

export const customersRouter = Router();
customersRouter.use(requireAuth, requireTenant);

customersRouter.get("/", customersController.list);
customersRouter.get("/search", customersController.search);
customersRouter.get("/:id", requirePermission("customer.view"), customersController.getById);
// NOTE: POST / keeps its legacy custom permission gate (customer.manage OR
// sale.create OR platform) inside the controller, so no requirePermission
// middleware here — and body shape is validated in the service to preserve
// the exact legacy "phone required" messages.
customersRouter.post("/", customersController.create);
customersRouter.patch("/:id", requirePermission("customer.manage"), validateBody(updateCustomerSchema), customersController.update);
customersRouter.delete("/:id", requirePermission("customer.manage"), customersController.remove);
customersRouter.post(
  "/:id/loyalty",
  requirePermission("loyalty.manage"),
  validateBody(adjustLoyaltySchema),
  customersController.adjustLoyalty,
);
