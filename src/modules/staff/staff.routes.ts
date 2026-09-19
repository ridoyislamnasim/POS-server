import { Router } from "express";
import { requireAuth, requirePermission, requirePlatformSuperAdmin, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { staffController } from "./staff.controller.js";
import {
  createAttendanceSchema,
  createRoleSchema,
  createShiftTemplateSchema,
  updateRoleSchema,
} from "./staff.validation.js";

export const staffRouter = Router();
staffRouter.use(requireAuth, requireTenant);

staffRouter.get("/permissions", requirePermission("user.manage"), staffController.listPermissions);
// Roles are platform-managed: only PLATFORM_SUPER_ADMIN lists, creates, edits, or deletes roles.
staffRouter.get("/roles", requirePlatformSuperAdmin, staffController.listRoles);
staffRouter.post("/roles", requirePlatformSuperAdmin, validateBody(createRoleSchema), staffController.createRole);
staffRouter.patch("/roles/:id", requirePlatformSuperAdmin, validateBody(updateRoleSchema), staffController.updateRole);
staffRouter.delete("/roles/:id", requirePlatformSuperAdmin, staffController.deleteRole);
staffRouter.get("/attendance", requirePermission("staff.view"), staffController.listAttendance);
staffRouter.post("/attendance", requirePermission("attendance.manage"), validateBody(createAttendanceSchema), staffController.createAttendance);
staffRouter.delete("/attendance/:id", requirePermission("attendance.manage"), staffController.deleteAttendance);
staffRouter.get("/shift-templates", requirePermission("shift.manage"), staffController.listShiftTemplates);
staffRouter.post("/shift-templates", requirePermission("shift.manage"), validateBody(createShiftTemplateSchema), staffController.createShiftTemplate);
staffRouter.get("/security/logins", requirePermission("user.manage"), staffController.listLogins);
staffRouter.get("/security/sessions", requirePermission("user.manage"), staffController.listSessions);
staffRouter.post("/security/sessions/:id/revoke", requirePermission("user.manage"), staffController.revokeSession);
