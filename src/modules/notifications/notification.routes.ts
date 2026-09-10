import { Router, type Request } from "express";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requirePermission } from "../../middleware/auth.js";
import { acceptId } from "../../lib/list-query.js";
import type { AuthedRequest } from "../../types.js";
import { processOutboxBatch } from "../outbox/worker.js";
import {
  listNotifications,
  markAllRead,
  markRead,
  recentNotifications,
  sendManual,
  unreadCount,
} from "./notification.service.js";
import { rescanLowStock } from "./stock-alert.js";

export const notificationRouter = Router();

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

notificationRouter.get("/unread-count", requirePermission("notification.view"), async (req, res) => {
  return ok(res, await unreadCount(ctxOf(req)));
});

notificationRouter.get("/recent", requirePermission("notification.view"), async (req, res) => {
  return ok(res, await recentNotifications(ctxOf(req), 8));
});

notificationRouter.post("/read-all", requirePermission("notification.view"), async (req, res) => {
  return ok(res, await markAllRead(ctxOf(req)));
});

notificationRouter.post("/low-stock", requirePermission("notification.send"), async (req, res) => {
  const ctx = ctxOf(req);
  if (!ctx.tenantId) return fail(res, "FORBIDDEN", "Tenant required", 403);
  const result = await rescanLowStock(ctx.tenantId);
  await processOutboxBatch(50);
  return ok(res, result);
});

notificationRouter.patch("/:id/read", requirePermission("notification.view"), async (req, res) => {
  const id = acceptId(req.params.id);
  if (!id) return fail(res, "VALIDATION", "Invalid notification");
  const row = await markRead(ctxOf(req), id);
  if (!row) return fail(res, "NOT_FOUND", "Notification not found", 404);
  return ok(res, row);
});

notificationRouter.get("/", requirePermission("notification.view"), async (req, res) => {
  const { rows, pagination } = await listNotifications(ctxOf(req), req.query as Record<string, unknown>);
  return okList(res, rows, pagination);
});

notificationRouter.post("/", requirePermission("notification.send"), async (req, res) => {
  try {
    const result = await sendManual(ctxOf(req), req.body ?? {});
    return ok(res, result, undefined, 201);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "RATE_LIMIT") return fail(res, "RATE_LIMIT", err.message ?? "Too many requests", 429);
    if (err.code === "VALIDATION") return fail(res, "VALIDATION", err.message ?? "Invalid payload");
    if (err.code === "FORBIDDEN") return fail(res, "FORBIDDEN", err.message ?? "Forbidden", 403);
    throw e;
  }
});
