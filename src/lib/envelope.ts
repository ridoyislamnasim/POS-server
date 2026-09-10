import type { Response } from "express";
import type { Pagination } from "./list-query.js";

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>, status = 200) {
  return res.status(status).json({ success: true, data, meta });
}

export function okList<T>(res: Response, data: T[], pagination: Pagination, status = 200) {
  return res.status(status).json({ success: true, data, pagination, meta: pagination });
}

export function fail(res: Response, code: string, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}
