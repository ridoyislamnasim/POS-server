import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { auditController } from "./audit.controller.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requireTenant, requirePermission("audit.view"));

auditRouter.get("/", auditController.list);
