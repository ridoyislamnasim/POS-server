import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { fail } from "../lib/envelope.js";

/**
 * Zod request-validation middleware.
 *
 * Runs BEFORE controllers/services so business logic never sees invalid input.
 * On failure responds with the existing `{ success:false, error:{code:"VALIDATION"} }`
 * envelope — no behavior change vs. the previous manual `if (!x) fail(...)` checks.
 */
function formatIssue(e: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  const first = e.issues[0];
  if (!first) return "Invalid request";
  const path = first.path.join(".");
  return path ? `${path}: ${first.message}` : first.message;
}

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return fail(res, "VALIDATION", formatIssue(parsed.error), 400);
    req.body = parsed.data;
    return next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return fail(res, "VALIDATION", formatIssue(parsed.error), 400);
    (req as { validatedQuery?: T }).validatedQuery = parsed.data;
    return next();
  };
}

export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return fail(res, "VALIDATION", formatIssue(parsed.error), 400);
    req.params = parsed.data as unknown as Request["params"];
    return next();
  };
}
