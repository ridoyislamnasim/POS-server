import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { usersController } from "./users.controller.js";
import { createUserSchema, updateUserSchema } from "./users.validation.js";

export const usersRouter = Router();
usersRouter.use(requireAuth, requireTenant);

usersRouter.get("/", requirePermission("user.manage"), usersController.list);
usersRouter.post("/", requirePermission("user.create"), validateBody(createUserSchema), usersController.create);
usersRouter.get("/roles", requirePermission("user.manage"), usersController.listRoles);
usersRouter.get("/:id", requirePermission("user.manage"), usersController.getById);
usersRouter.patch("/:id", requirePermission("user.manage"), validateBody(updateUserSchema), usersController.update);
usersRouter.post("/:id/deactivate", requirePermission("user.manage"), usersController.deactivate);
