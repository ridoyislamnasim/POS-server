import type { NextFunction, Request, Response } from "express";
import { fail } from "../lib/envelope.js";
import { asCodedError, statusForCode } from "../utils/errors.js";

/**
 * Map Prisma known-request errors to the existing API error codes
 * without leaking database internals.
 */
function prismaToApi(e: unknown): { code: string; message: string; status: number } | null {
  const rec = e as { code?: unknown; meta?: unknown } | null;
  if (!rec || typeof rec !== "object" || rec.code !== "P2002") return null;
  const target = (rec.meta as { target?: unknown } | undefined)?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target ?? "");
  if (/email/i.test(text)) return { code: "CONFLICT", message: "Email already in use", status: 409 };
  if (/phone/i.test(text)) return { code: "CONFLICT", message: "Phone already in use", status: 409 };
  if (/sku/i.test(text)) return { code: "CONFLICT", message: "SKU already exists", status: 409 };
  if (/invoiceNumber/i.test(text)) return { code: "CONFLICT", message: "Document number already exists", status: 409 };
  return { code: "CONFLICT", message: "Already exists", status: 409 };
}

/**
 * Centralized error handler — the last middleware in the chain.
 *
 * Controllers should `try { ... } catch (e) { next(e); }` (or use
 * `asyncHandler`). Thrown `{ code }` errors from the service layer
 * (legacy `Object.assign(new Error, { code })` and new `AppError`s)
 * are mapped to the SAME `{ success:false, error:{code,message} }`
 * envelope and status the old inline `fail(...)` calls produced.
 *
 * Production responses never include stack traces or DB internals.
 */
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  const prismaMapped = prismaToApi(err);
  if (prismaMapped) {
    return fail(res, prismaMapped.code, prismaMapped.message, prismaMapped.status);
  }

  const coded = asCodedError(err);
  if (coded.code) {
    const status = coded.status ?? statusForCode(coded.code);
    const message =
      process.env.NODE_ENV === "production" && status === 500
        ? "Unexpected error"
        : coded.message || "Unexpected error";
    return fail(res, coded.code, message, status, coded.details);
  }

  // eslint-disable-next-line no-console
  console.error(err);
  const exposed =
    process.env.NODE_ENV === "production"
      ? "Unexpected error"
      : err instanceof Error
        ? err.message || "Unexpected error"
        : "Unexpected error";
  return fail(res, "INTERNAL", exposed, 500);
}

export function notFoundMiddleware(_req: Request, res: Response) {
  res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } });
}
