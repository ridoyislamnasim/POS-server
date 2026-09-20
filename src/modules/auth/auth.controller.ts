import type { NextFunction, Request, Response } from "express";
import { ok, fail } from "../../utils/response.js";
import { clearAuthCookies, setAuthCookies } from "../../lib/cookies.js";
import { saveDataUrl } from "../../lib/uploads.js";
import type { AuthedRequest } from "../../types.js";
import { authService } from "./auth.service.js";
import type { UpdateProfileBody, ChangePasswordBody } from "./auth.types.js";

/**
 * HTTP-only: extract req data, call the service, write the response.
 * No Prisma, no hashing, no token logic here.
 */
export const authController = {
  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.login(
        {
          email: req.body?.email,
          password: req.body?.password,
          tenantId: req.body?.tenantId,
        },
        { ip: req.ip, userAgent: req.headers["user-agent"] },
      );
      setAuthCookies(res, result.access, result.refresh, result.csrf, req.hostname);
      return ok(res, { accessToken: result.access, user: result.user });
    } catch (e) {
      return next(e);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = (req as AuthedRequest).ctx;
      const result = await authService.logout(ctx, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      });
      clearAuthCookies(res, req.hostname);
      return ok(res, result);
    } catch (e) {
      return next(e);
    }
  },

  async me(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.me((req as AuthedRequest).ctx);
      return ok(res, result);
    } catch (e) {
      return next(e);
    }
  },

  async profile(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await authService.profile((req as AuthedRequest).ctx);
      return ok(res, result);
    } catch (e) {
      return next(e);
    }
  },

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as UpdateProfileBody;
      const imageUrl = body.imageUrl;
      const result = await authService.updateProfile((req as AuthedRequest).ctx, {
        name: body.name,
        imageUrl,
      });
      return ok(res, result);
    } catch (e) {
      return next(e);
    }
  },

  async uploadImage(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as { image?: string };
      if (!body.image) {
        return fail(res, "VALIDATION", "Image data required", 400);
      }
      const imageUrl = await saveDataUrl(body.image);
      const result = await authService.updateProfile((req as AuthedRequest).ctx, { imageUrl });
      return ok(res, result);
    } catch (e) {
      return next(e);
    }
  },

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const body = req.body as ChangePasswordBody;
      const result = await authService.changePassword((req as AuthedRequest).ctx, body);
      return ok(res, result);
    } catch (e) {
      return next(e);
    }
  },
};
