import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { orgController } from "./org.controller.js";
import {
  createBranchSchema,
  createWarehouseSchema,
  updateBranchSchema,
  updateBusinessSchema,
  updateWarehouseSchema,
} from "./org.validation.js";

export const orgRouter = Router();
orgRouter.use(requireAuth, requireTenant);

orgRouter.get("/business", requirePermission("tenant.manage"), orgController.getBusiness);
orgRouter.patch("/business", requirePermission("tenant.manage"), validateBody(updateBusinessSchema), orgController.updateBusiness);
orgRouter.get("/branches", requirePermission("branch.manage"), orgController.listBranches);
orgRouter.post("/branches", requirePermission("branch.manage"), validateBody(createBranchSchema), orgController.createBranch);
orgRouter.patch("/branches/:id", requirePermission("branch.manage"), validateBody(updateBranchSchema), orgController.updateBranch);
orgRouter.delete("/branches/:id", requirePermission("branch.manage"), orgController.deleteBranch);
orgRouter.get("/warehouses", requirePermission("warehouse.manage"), orgController.listWarehouses);
orgRouter.post("/warehouses", requirePermission("warehouse.manage"), validateBody(createWarehouseSchema), orgController.createWarehouse);
orgRouter.patch("/warehouses/:id", requirePermission("warehouse.manage"), validateBody(updateWarehouseSchema), orgController.updateWarehouse);
orgRouter.delete("/warehouses/:id", requirePermission("warehouse.manage"), orgController.deleteWarehouse);
