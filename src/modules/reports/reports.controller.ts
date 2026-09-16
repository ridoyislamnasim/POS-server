import type { NextFunction, Request, Response } from "express";
import { ok } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { reportsService } from "./reports.service.js";

/** HTTP-only. */
export const reportsController = {
  async sales(req: Request, res: Response, next: NextFunction) {
    try {
      const { body, pagination } = await reportsService.sales(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return ok(res, body, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async purchases(req: Request, res: Response, next: NextFunction) {
    try {
      const { body, pagination } = await reportsService.purchases(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return ok(res, body, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async inventory(req: Request, res: Response, next: NextFunction) {
    try {
      const { body, pagination } = await reportsService.inventory(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return ok(res, body, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async profit(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await reportsService.profit((req as AuthedRequest).ctx, req.query as Record<string, unknown>));
    } catch (e) {
      return next(e);
    }
  },

  async expenses(req: Request, res: Response, next: NextFunction) {
    try {
      const { body, pagination } = await reportsService.expenses(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return ok(res, body, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async dues(req: Request, res: Response, next: NextFunction) {
    try {
      const { body, pagination } = await reportsService.dues(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return ok(res, body, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async tax(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await reportsService.tax((req as AuthedRequest).ctx, req.query as Record<string, unknown>));
    } catch (e) {
      return next(e);
    }
  },

  async cashier(req: Request, res: Response, next: NextFunction) {
    try {
      const { body, pagination } = await reportsService.cashier(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return ok(res, body, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async products(req: Request, res: Response, next: NextFunction) {
    try {
      const { body, pagination } = await reportsService.products(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return ok(res, body, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async returns(req: Request, res: Response, next: NextFunction) {
    try {
      const { body, pagination } = await reportsService.returns(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return ok(res, body, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async receiving(req: Request, res: Response, next: NextFunction) {
    try {
      const { body, pagination } = await reportsService.receiving(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return ok(res, body, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async damage(req: Request, res: Response, next: NextFunction) {
    try {
      const { body, pagination } = await reportsService.damage(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return ok(res, body, pagination);
    } catch (e) {
      return next(e);
    }
  },
};
