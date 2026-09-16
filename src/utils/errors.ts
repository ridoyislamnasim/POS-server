/**
 * Centralized application error hierarchy.
 *
 * Compatible with the existing codebase convention of
 * `throw Object.assign(new Error(msg), { code: "VALIDATION" })`
 * and `throw new ForbiddenError()` from `lib/scope.ts`.
 *
 * New service-layer code should prefer these classes.
 * The centralized error middleware (`middleware/error.middleware.ts`)
 * maps `code` -> HTTP status so controllers can simply `next(error)`.
 */

export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INSUFFICIENT_STOCK"
  | "SHIFT_REQUIRED"
  | "SHIFT_ALREADY_OPEN"
  | "DISCOUNT_APPROVAL_REQUIRED"
  | "CREDIT_LIMIT"
  | "PLAN_LIMIT_REACHED"
  | "FEATURE_NOT_ENABLED"
  | "SUBSCRIPTION_SUSPENDED"
  | "PAYMENT_REQUIRED"
  | "ENTITLEMENT"
  | "TENANT_MISMATCH"
  | "DUPLICATE_VARIANT"
  | "IDEMPOTENT_REPLAY"
  | "RATE_LIMIT"
  | "INTERNAL";

const CODE_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INSUFFICIENT_STOCK: 409,
  SHIFT_ALREADY_OPEN: 409,
  SHIFT_REQUIRED: 400,
  DISCOUNT_APPROVAL_REQUIRED: 400,
  CREDIT_LIMIT: 400,
  PLAN_LIMIT_REACHED: 403,
  FEATURE_NOT_ENABLED: 403,
  SUBSCRIPTION_SUSPENDED: 403,
  ENTITLEMENT: 403,
  TENANT_MISMATCH: 403,
  DUPLICATE_VARIANT: 409,
  IDEMPOTENT_REPLAY: 200,
  RATE_LIMIT: 429,
  INTERNAL: 500,
};

export function statusForCode(code: string | undefined, fallback = 400): number {
  if (!code) return fallback;
  return (CODE_STATUS as Record<string, number>)[code] ?? fallback;
}

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode | string, message: string, status?: number, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status ?? statusForCode(code);
    if (details) this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: Record<string, unknown>) {
    super("VALIDATION", message, 400, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Sign in required") {
    super("UNAUTHORIZED", message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super("FORBIDDEN", message, 403);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message, 404);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super("CONFLICT", message, 409);
  }
}

/** Throw helpers for service-layer code (no Express dependency). */
export function badRequest(message: string, details?: Record<string, unknown>): never {
  throw new BadRequestError(message, details);
}

export function unauthorized(message = "Sign in required"): never {
  throw new UnauthorizedError(message);
}

export function forbidden(message = "Forbidden"): never {
  throw new ForbiddenError(message);
}

export function notFound(message = "Not found"): never {
  throw new NotFoundError(message);
}

export function conflict(message = "Conflict"): never {
  throw new ConflictError(message);
}

/** Legacy helper: keep old `validation(msg)` / `conflict(msg)` call-sites working. */
export function codedError(code: ErrorCode | string, message: string, status?: number): Error & { code: string } {
  return Object.assign(new AppError(code, message, status), { code });
}

/** Narrow `unknown` thrown values to `{ code?, message }` without using `any`. */
export function asCodedError(e: unknown): { code?: string; message: string; status?: number; details?: Record<string, unknown> } {
  if (e instanceof AppError) return { code: e.code, message: e.message, status: e.status, details: e.details };
  if (typeof e === "object" && e !== null) {
    const rec = e as Record<string, unknown>;
    const code = typeof rec.code === "string" ? rec.code : undefined;
    const message = e instanceof Error ? e.message : typeof rec.message === "string" ? rec.message : "Unexpected error";
    const status = typeof rec.status === "number" ? rec.status : undefined;
    const details = typeof rec.details === "object" && rec.details !== null ? (rec.details as Record<string, unknown>) : undefined;
    return { code, message, status, details };
  }
  return { message: "Unexpected error" };
}
