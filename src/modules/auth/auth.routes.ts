import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { authController } from "./auth.controller.js";
import { updateProfileSchema, changePasswordSchema } from "./auth.validation.js";

export const authRouter = Router();

// NOTE: body shape is validated inside authService.login so the exact
// legacy "Email and password required" message/status is preserved.
authRouter.post("/login", authController.login);
authRouter.post("/logout", requireAuth, authController.logout);
authRouter.get("/me", requireAuth, authController.me);
authRouter.get("/profile", requireAuth, authController.profile);
authRouter.patch("/profile", requireAuth, authController.updateProfile);
authRouter.post("/profile/image", requireAuth, authController.uploadImage);
authRouter.post("/change-password", requireAuth, validateBody(changePasswordSchema), authController.changePassword);
