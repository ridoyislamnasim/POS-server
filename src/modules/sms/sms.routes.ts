import { Router, type Request, type Response } from "express";
import { fail, ok, okList } from "../../lib/envelope.js";
import { isPlatformActor, requireAuth, requirePermission, requirePlatform, requireTenant } from "../../middleware/auth.js";
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

export const smsRouter = Router();
smsRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

function handleSmsError(res: Response, e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === "RATE_LIMIT") return fail(res, "RATE_LIMIT", err.message ?? "Too many requests", 429);
  if (err.code === "VALIDATION") return fail(res, "VALIDATION", err.message ?? "Invalid payload");
  if (err.code === "FORBIDDEN") return fail(res, "FORBIDDEN", err.message ?? "Forbidden", 403);
  if (err.code === "NOT_FOUND") return fail(res, "NOT_FOUND", err.message ?? "Not found", 404);
  throw e;
}

smsRouter.get("/dashboard", requirePermission("sms.view"), async (req, res) => {
  return ok(res, await getDashboard(ctxOf(req)));
});

smsRouter.get("/settings", requirePermission("sms.settings"), async (req, res) => {
  return ok(res, await getSettings(ctxOf(req)));
});

smsRouter.patch("/settings", requirePermission("sms.settings"), async (req, res) => {
  try {
    return ok(res, await updateSettings(ctxOf(req), req.body ?? {}));
  } catch (e) {
    return handleSmsError(res, e);
  }
});

smsRouter.get("/templates", async (req, res) => {
  const ctx = ctxOf(req);
  if (!ctx.isPlatform && !ctx.roles.includes("TENANT_OWNER") && !ctx.permissions.includes("sms.view") && !ctx.permissions.includes("sms.send") && !ctx.permissions.includes("sms.settings")) {
    return fail(res, "FORBIDDEN", "Missing permission", 403);
  }
  return ok(res, await listTemplates(ctx));
});

smsRouter.patch("/templates/:id", requirePermission("sms.settings"), async (req, res) => {
  try {
    const id = acceptId(req.params.id);
    if (!id) return fail(res, "VALIDATION", "Invalid template");
    return ok(res, await updateTemplate(ctxOf(req), id, req.body ?? {}));
  } catch (e) {
    return handleSmsError(res, e);
  }
});

smsRouter.post("/templates/:id/reset", requirePermission("sms.settings"), async (req, res) => {
  try {
    const id = acceptId(req.params.id);
    if (!id) return fail(res, "VALIDATION", "Invalid template");
    return ok(res, await resetTemplate(ctxOf(req), id));
  } catch (e) {
    return handleSmsError(res, e);
  }
});

smsRouter.post("/preview", async (req, res) => {
  const ctx = ctxOf(req);
  if (!ctx.isPlatform && !ctx.roles.includes("TENANT_OWNER") && !ctx.permissions.includes("sms.send") && !ctx.permissions.includes("sms.view") && !ctx.permissions.includes("sms.settings")) {
    return fail(res, "FORBIDDEN", "Missing permission", 403);
  }
  try {
    return ok(res, await previewSms({ tenantId: smsTenantId(ctx), ...(req.body ?? {}) }));
  } catch (e) {
    return handleSmsError(res, e);
  }
});

smsRouter.get("/logs", requirePermission("sms.view"), async (req, res) => {
  const { rows, pagination } = await listLogs(ctxOf(req), req.query as Record<string, unknown>);
  return okList(res, rows, pagination);
});

smsRouter.post("/logs/:id/retry", requirePermission("sms.send"), async (req, res) => {
  try {
    const id = acceptId(req.params.id);
    if (!id) return fail(res, "VALIDATION", "Invalid log");
    return ok(res, await retryLog(ctxOf(req), id));
  } catch (e) {
    return handleSmsError(res, e);
  }
});

smsRouter.post("/send", requirePermission("sms.send"), async (req, res) => {
  try {
    const result = await sendManualSms(ctxOf(req), req.body ?? {});
    return ok(res, result, undefined, 201);
  } catch (e) {
    return handleSmsError(res, e);
  }
});

smsRouter.get("/usage", requirePermission("sms.view"), async (req, res) => {
  return ok(res, await getUsage(ctxOf(req)));
});

smsRouter.post("/usage/refresh-balance", requirePermission("sms.settings"), async (req, res) => {
  return ok(res, await refreshBalance(ctxOf(req)));
});

smsRouter.patch("/platform-access", requirePlatform, async (req, res) => {
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
    return handleSmsError(res, e);
  }
});
