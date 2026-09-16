import type { NextFunction, Request, Response } from "express";
import { fail, ok, okList } from "../../utils/response.js";
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

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

/** HTTP-only. */
export const notificationController = {
  async unreadCount(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await unreadCount(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async recent(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await recentNotifications(ctxOf(req), 8));
    } catch (e) {
      return next(e);
    }
  },

  async readAll(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await markAllRead(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async rescanLowStock(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      if (!ctx.tenantId) return fail(res, "FORBIDDEN", "Tenant required", 403);
      const result = await rescanLowStock(ctx.tenantId);
      await processOutboxBatch(50);
      return ok(res, result);
    } catch (e) {
      return next(e);
    }
  },

  async markRead(req: Request, res: Response, next: NextFunction) {
    try {
      const id = acceptId(req.params.id);
      if (!id) return fail(res, "VALIDATION", "Invalid notification");
      const row = await markRead(ctxOf(req), id);
      if (!row) return fail(res, "NOT_FOUND", "Notification not found", 404);
      return ok(res, row);
    } catch (e) {
      return next(e);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await listNotifications(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async send(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await sendManual(ctxOf(req), req.body ?? {}), undefined, 201);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err.code === "RATE_LIMIT" || err.code === "VALIDATION" || err.code === "FORBIDDEN") {
        const status = err.code === "RATE_LIMIT" ? 429 : err.code === "FORBIDDEN" ? 403 : 400;
        return fail(res, err.code, err.message ?? "Invalid payload", status);
      }
      return next(e);
    }
  },
};
