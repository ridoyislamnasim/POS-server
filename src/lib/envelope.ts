import type { Response } from "express";

export function ok<T>(res: Response, data: T, meta?: Record<string, unknown>, status = 200) {
  return res.status(status).json({ success: true, data, meta });
}

export function fail(res: Response, code: string, message: string, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}
