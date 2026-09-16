import type { NextFunction, Request, Response } from "express";
import { fail, ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { purchasesService } from "./purchases.service.js";
import { purchaseReturnsService } from "./purchases.returns.service.js";

/** HTTP-only. */
export const purchasesController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await purchasesService.list(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async listOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await purchasesService.listOrders(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async getOrder(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await purchasesService.getOrder((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async createOrder(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await purchasesService.createOrder((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async cancelOrder(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await purchasesService.cancelOrder((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async receive(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await purchasesService.receive((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async listReturns(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await purchaseReturnsService.list(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await purchasesService.getById((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async createReturn(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await purchaseReturnsService.create(
        (req as AuthedRequest).ctx,
        String(req.params.id),
        req.body ?? {},
      );
      return ok(res, row, undefined, 201);
    } catch (e) {
      // Preserve the legacy mapping for this endpoint: INSUFFICIENT_STOCK -> 409, else 400.
      const err = e as Error & { code?: string };
      if (err.code === "INSUFFICIENT_STOCK" || err.code === "VALIDATION" || err.code === "NOT_FOUND") {
        return fail(res, err.code ?? "VALIDATION", err.message, err.code === "INSUFFICIENT_STOCK" ? 409 : 400);
      }
      return next(e);
    }
  },
};
