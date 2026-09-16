import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { staffController } from "./staff.controller.js";
import {
  createAttendanceSchema,
  createShiftTemplateSchema,
  updateRoleSchema,
} from "./staff.validation.js";

export const staffRouter = Router();
staffRouter.use(requireAuth, requireTenant);

staffRouter.get("/permissions", requirePermission("user.manage"), staffController.listPermissions);
staffRouter.get("/roles", requirePermission("user.manage"), staffController.listRoles);
staffRouter.patch("/roles/:id", requirePermission("user.manage"), validateBody(updateRoleSchema), staffController.updateRole);
staffRouter.get("/attendance", requirePermission("staff.view"), staffController.listAttendance);
staffRouter.post("/attendance", requirePermission("attendance.manage"), validateBody(createAttendanceSchema), staffController.createAttendance);
staffRouter.delete("/attendance/:id", requirePermission("attendance.manage"), staffController.deleteAttendance);
staffRouter.get("/shift-templates", requirePermission("shift.manage"), staffController.listShiftTemplates);
staffRouter.post("/shift-templates", requirePermission("shift.manage"), validateBody(createShiftTemplateSchema), staffController.createShiftTemplate);
staffRouter.get("/security/logins", requirePermission("user.manage"), staffController.listLogins);
staffRouter.get("/security/sessions", requirePermission("user.manage"), staffController.listSessions);
staffRouter.post("/security/sessions/:id/revoke", requirePermission("user.manage"), staffController.revokeSession);
