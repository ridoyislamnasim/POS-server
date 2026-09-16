import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { shiftsController } from "./shifts.controller.js";
import { closeShiftSchema, openShiftSchema } from "./shifts.validation.js";

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth, requireTenant);

shiftsRouter.get("/", requirePermission("shift.manage"), shiftsController.list);
shiftsRouter.get("/current", shiftsController.current);
shiftsRouter.post("/open", requirePermission("shift.open"), validateBody(openShiftSchema), shiftsController.open);
shiftsRouter.post("/:id/close", requirePermission("shift.close"), validateBody(closeShiftSchema), shiftsController.close);
