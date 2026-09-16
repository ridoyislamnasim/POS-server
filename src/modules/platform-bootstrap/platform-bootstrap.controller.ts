import type { NextFunction, Request, Response } from "express";
import { ok } from "../../utils/response.js";
import { platformBootstrapService } from "./platform-bootstrap.service.js";

export const platformBootstrapController = {
  async bootstrap(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await platformBootstrapService.bootstrap(req.body ?? {}, {
        ip: req.ip,
        userAgent: req.headers["user-agent"],
        bootstrapToken:
          (req.headers["x-bootstrap-token"] as string | undefined) ??
          (req.headers["x-setup-key"] as string | undefined),
      } as { ip?: string; userAgent?: string; bootstrapToken?: unknown });
      return ok(res, result, undefined, 201);
    } catch (e) {
      return next(e);
    }
  },
};
