import type { NextFunction, Request, Response } from "express";
import { ok } from "../../utils/response.js";
import { clearAuthCookies, setAuthCookies } from "../../lib/cookies.js";
import type { AuthedRequest } from "../../types.js";
import { authService } from "./auth.service.js";

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
};
