import type { NextFunction, Request, Response } from "express";
import { fail, ok, okList } from "../../utils/response.js";
import { isPlatformActor } from "../../middleware/auth.js";
import { acceptId } from "../../lib/list-query.js";
import type { AuthedRequest } from "../../types.js";
import {
  getDashboard,
  getSettings,
  getUsage,
  listLogs,
  listTemplates,
  previewSms,
  refreshBalance,
  resetTemplate,
  retryLog,
  sendManualSms,
  setPlatformAccess,
  smsTenantId,
  updateSettings,
  updateTemplate,
} from "./sms.service.js";

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

function canBrowse(ctx: AuthedRequest["ctx"]) {
  return (
    ctx.isPlatform ||
    ctx.roles.includes("TENANT_OWNER") ||
    ctx.permissions.includes("sms.view") ||
    ctx.permissions.includes("sms.send") ||
    ctx.permissions.includes("sms.settings")
  );
}

/** HTTP-only. Service error codes map 1:1 via the centralized error middleware. */
export const smsController = {
  async dashboard(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await getDashboard(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async getSettings(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await getSettings(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async updateSettings(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await updateSettings(ctxOf(req), req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async listTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      if (!canBrowse(ctxOf(req))) return fail(res, "FORBIDDEN", "Missing permission", 403);
      return ok(res, await listTemplates(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async updateTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const id = acceptId(req.params.id);
      if (!id) return fail(res, "VALIDATION", "Invalid template");
      return ok(res, await updateTemplate(ctxOf(req), id, req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async resetTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const id = acceptId(req.params.id);
      if (!id) return fail(res, "VALIDATION", "Invalid template");
      return ok(res, await resetTemplate(ctxOf(req), id));
    } catch (e) {
      return next(e);
    }
  },

  async preview(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      if (
        !ctx.isPlatform &&
        !ctx.roles.includes("TENANT_OWNER") &&
        !ctx.permissions.includes("sms.send") &&
        !ctx.permissions.includes("sms.view") &&
        !ctx.permissions.includes("sms.settings")
      ) {
        return fail(res, "FORBIDDEN", "Missing permission", 403);
      }
      return ok(res, await previewSms({ tenantId: smsTenantId(ctx), ...(req.body ?? {}) }));
    } catch (e) {
      return next(e);
    }
  },

  async listLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await listLogs(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async retryLog(req: Request, res: Response, next: NextFunction) {
    try {
      const id = acceptId(req.params.id);
      if (!id) return fail(res, "VALIDATION", "Invalid log");
      return ok(res, await retryLog(ctxOf(req), id));
    } catch (e) {
      return next(e);
    }
  },

  async send(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await sendManualSms(ctxOf(req), req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async usage(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await getUsage(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async refreshBalance(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await refreshBalance(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async setPlatformAccess(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const tenantId = typeof req.body?.tenantId === "string" && req.body.tenantId ? req.body.tenantId : smsTenantId(ctx);
      if (!isPlatformActor(ctx)) return fail(res, "FORBIDDEN", "Platform access required", 403);
      return ok(
        res,
        await setPlatformAccess({
          tenantId,
          enabled: req.body?.enabled !== false,
          reason: typeof req.body?.reason === "string" ? req.body.reason : null,
          actor: ctx,
        }),
      );
    } catch (e) {
      return next(e);
    }
  },
};
