import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { authController } from "./auth.controller.js";

export const authRouter = Router();

// NOTE: body shape is validated inside authService.login so the exact
// legacy "Email and password required" message/status is preserved.
authRouter.post("/login", authController.login);
authRouter.post("/logout", requireAuth, authController.logout);
authRouter.get("/me", requireAuth, authController.me);
