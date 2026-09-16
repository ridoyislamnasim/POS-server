import type { NextFunction, Request, Response } from "express";
import { fail, ok, okList } from "../../utils/response.js";
import { ForbiddenError, InsufficientStockError } from "../../lib/scope.js";
import type { CreateSaleBody, CreateSaleReturnBody } from "./sales.validation.js";
import type { AuthedRequest } from "../../types.js";
import { createSale } from "./sales.service.js";
import { saleRepository } from "./sale.repository.js";
import { holdsService } from "./sales.holds.service.js";
import {
  createSaleReturn,
  decideSaleReturn,
  getReturn,
  listReturns,
  refundSaleReturn,
  returnsSummary,
  voidSale,
} from "./returns.service.js";

function ctxOf(req: Request) {
  return (req as unknown as AuthedRequest).ctx;
}

function saleErr(res: Parameters<typeof fail>[0], e: unknown) {
  const err = e as Error & { code?: string };
  const status =
    err.code === "INSUFFICIENT_STOCK"
      ? 409
      : err instanceof ForbiddenError || err.code === "FORBIDDEN"
        ? 403
        : err instanceof InsufficientStockError
          ? 409
          : 400;
  return fail(res, err.code ?? "VALIDATION", err.message, status);
}

/** HTTP-only. Error mappings preserve the legacy per-endpoint behavior. */
export const salesController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const result = await createSale({
        ctx,
        correlationId: (req as AuthedRequest).correlationId,
        idempotencyKey: (req.headers["idempotency-key"] as string | undefined) ?? undefined,
        ...(req.body as CreateSaleBody),
      });
      return ok(res, result.body, { replay: result.replay }, result.replay ? 200 : 201);
    } catch (e) {
      return saleErr(res, e);
    }
  },

  async listOpenHolds(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await holdsService.listOpen(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await saleRepository.list(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
      return next(e);
    }
  },

  async listReturns(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await listReturns(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async returnsSummary(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await returnsSummary(ctxOf(req), req.query as Record<string, unknown>));
    } catch (e) {
      return next(e);
    }
  },

  async getReturn(req: Request, res: Response, _next: NextFunction) {
    try {
      return ok(res, await getReturn(ctxOf(req), String(req.params.id)));
    } catch (e) {
      const err = e as Error & { code?: string };
      const status = err.code === "NOT_FOUND" ? 404 : err instanceof ForbiddenError || err.code === "FORBIDDEN" ? 403 : 400;
      return fail(res, err.code ?? "VALIDATION", err.message, status);
    }
  },

  async approveReturn(req: Request, res: Response, _next: NextFunction) {
    try {
      return ok(
        res,
        await decideSaleReturn({ ctx: ctxOf(req), id: String(req.params.id), approve: true, refund: req.body?.refund }),
      );
    } catch (e) {
      const err = e as Error & { code?: string };
      const status = err instanceof ForbiddenError || err.code === "FORBIDDEN" ? 403 : 400;
      return fail(res, err.code ?? "VALIDATION", err.message, status);
    }
  },

  async rejectReturn(req: Request, res: Response, _next: NextFunction) {
    try {
      return ok(res, await decideSaleReturn({ ctx: ctxOf(req), id: String(req.params.id), approve: false }));
    } catch (e) {
      const err = e as Error & { code?: string };
      const status = err instanceof ForbiddenError || err.code === "FORBIDDEN" ? 403 : 400;
      return fail(res, err.code ?? "VALIDATION", err.message, status);
    }
  },

  async refundReturn(req: Request, res: Response, _next: NextFunction) {
    try {
      return ok(
        res,
        await refundSaleReturn({
          ctx: ctxOf(req),
          id: String(req.params.id),
          amount: req.body?.amount != null ? Number(req.body.amount) : undefined,
          method: req.body?.method,
          idempotencyKey: (req.headers["idempotency-key"] as string | undefined) ?? req.body?.idempotencyKey,
        }),
      );
    } catch (e) {
      const err = e as Error & { code?: string };
      const status = err instanceof ForbiddenError || err.code === "FORBIDDEN" ? 403 : 400;
      return fail(res, err.code ?? "VALIDATION", err.message, status);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await saleRepository.getById(ctxOf(req), String(req.params.id)));
    } catch (e) {
      if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
      return next(e);
    }
  },

  async createReturn(req: Request, res: Response, _next: NextFunction) {
    try {
      const row = await createSaleReturn({
        ctx: ctxOf(req),
        saleId: String(req.params.id),
        idempotencyKey: req.headers["idempotency-key"] as string | undefined,
        ...(req.body as CreateSaleReturnBody),
      });
      return ok(res, row, undefined, 201);
    } catch (e) {
      const err = e as Error & { code?: string };
      const status =
        err.code === "INSUFFICIENT_STOCK" || err instanceof InsufficientStockError
          ? 409
          : err instanceof ForbiddenError || err.code === "FORBIDDEN"
            ? 403
            : 400;
      return fail(res, err.code ?? "VALIDATION", err.message, status);
    }
  },

  async void(req: Request, res: Response, _next: NextFunction) {
    try {
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) return fail(res, "VALIDATION", "reason required");
      return ok(res, await voidSale({ ctx: ctxOf(req), saleId: String(req.params.id), reason }));
    } catch (e) {
      const err = e as Error & { code?: string };
      const status = err instanceof ForbiddenError || err.code === "FORBIDDEN" ? 403 : 400;
      return fail(res, err.code ?? "VALIDATION", err.message, status);
    }
  },

  async hold(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await holdsService.create(
        ctxOf(req),
        req.body ?? {},
        (req as AuthedRequest).correlationId,
      );
      return ok(res, row, undefined, 201);
    } catch (e) {
      if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
      return next(e);
    }
  },

  async deleteHold(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await holdsService.remove(ctxOf(req), String(req.params.id)));
    } catch (e) {
      if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
      return next(e);
    }
  },
};
