import type { NextFunction, Request, Response } from "express";
import { fail } from "../lib/envelope.js";
import { CSRF_COOKIE } from "../lib/cookies.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function csrfProtect(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  if (req.headers.authorization?.startsWith("Bearer ")) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  if (!cookie) return next();
  const header = req.headers["x-csrf-token"];
  if (header !== cookie) return fail(res, "FORBIDDEN", "CSRF token mismatch", 403);
  next();
}
