import { Router } from "express";
import { validateBody } from "../../middleware/validate.js";
import { platformBootstrapController } from "./platform-bootstrap.controller.js";
import { bootstrapPlatformSchema } from "./platform-bootstrap.validation.js";

// No requireAuth / requireTenant here on purpose: this is the one-time
// no-login bootstrap. Gated by PLATFORM_BOOTSTRAP_TOKEN + one-time check
// inside the service. Do NOT mount under usersRouter.
export const platformBootstrapRouter = Router();

platformBootstrapRouter.post(
  "/bootstrap",
  validateBody(bootstrapPlatformSchema),
  platformBootstrapController.bootstrap,
);
