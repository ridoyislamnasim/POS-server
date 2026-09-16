import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { suppliersController } from "./suppliers.controller.js";
import { createSupplierSchema, updateSupplierSchema } from "./suppliers.validation.js";

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth, requireTenant);

suppliersRouter.get("/", requirePermission("supplier.view"), suppliersController.list);
suppliersRouter.get("/:id", requirePermission("supplier.view"), suppliersController.getById);
suppliersRouter.post("/", requirePermission("supplier.manage"), validateBody(createSupplierSchema), suppliersController.create);
suppliersRouter.patch("/:id", requirePermission("supplier.manage"), validateBody(updateSupplierSchema), suppliersController.update);
suppliersRouter.delete("/:id", requirePermission("supplier.manage"), suppliersController.remove);
