import type { NextFunction, Request, Response } from "express";
import { ok } from "../../utils/response.js";
import { tenantId } from "../../lib/erp.js";
import type { AuthedRequest } from "../../types.js";
import { tenantAccessViews } from "./tenant-access.views.service.js";

/** HTTP-only. */
export const tenantAccessController = {
  async plan(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await tenantAccessViews.plan(tenantId((req as AuthedRequest).ctx)));
    } catch (e) {
      return next(e);
    }
  },

  async usage(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await tenantAccessViews.usage(tenantId((req as AuthedRequest).ctx)));
    } catch (e) {
      return next(e);
    }
  },

  async monthlyUsage(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await tenantAccessViews.monthlyUsage(tenantId((req as AuthedRequest).ctx)));
    } catch (e) {
      return next(e);
    }
  },

  async plans(_req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await tenantAccessViews.plans());
    } catch (e) {
      return next(e);
    }
  },

  async overLimit(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await tenantAccessViews.overLimit(tenantId((req as AuthedRequest).ctx)));
    } catch (e) {
      return next(e);
    }
  },
};
