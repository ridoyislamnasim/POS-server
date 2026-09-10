import type { NextFunction, Request, Response } from "express";
import { fail } from "../lib/envelope.js";
import { CSRF_COOKIE } from "../lib/cookies.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);
const SKIP = new Set(["/api/v1/auth/login"]);

export function csrfProtect(req: Request, res: Response, next: NextFunction) {
  if (SAFE.has(req.method)) return next();
  if (SKIP.has(req.path)) return next();
  if (req.headers.authorization?.startsWith("Bearer ")) return next();
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.headers["x-csrf-token"];
  if (!cookie || typeof header !== "string" || header !== cookie) {
    return fail(res, "FORBIDDEN", "CSRF token mismatch", 403);
  }
  next();
}
