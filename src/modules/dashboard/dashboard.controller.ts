import type { NextFunction, Request, Response } from "express";
import { ok } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import {
  dashboardByCashier,
  dashboardCustomers,
  dashboardHourly,
  dashboardInventory,
  dashboardPayments,
  dashboardRecentActivity,
  dashboardRecentSales,
  dashboardReturns,
  dashboardSales,
  dashboardSummary,
  dashboardTopCustomers,
  dashboardTopProducts,
  periodRange,
} from "./dashboard.service.js";

function range(req: Request) {
  const authed = req as AuthedRequest;
  const period = String(req.query.period ?? "today");
  const computed = periodRange(period, authed.ctx.businessDate);
  const from = String(req.query.from ?? computed.from);
  const to = String(req.query.to ?? computed.to);
  return { period, from, to };
}

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

/** HTTP-only. */
export const dashboardController = {
  async summary(req: Request, res: Response, next: NextFunction) {
    try {
      const { from, to } = range(req);
      return ok(res, await dashboardSummary(ctxOf(req), from, to));
    } catch (e) {
      return next(e);
    }
  },

  async sales(req: Request, res: Response, next: NextFunction) {
    try {
      const { period, from, to } = range(req);
      return ok(res, await dashboardSales(ctxOf(req), period, from, to));
    } catch (e) {
      return next(e);
    }
  },

  async payments(req: Request, res: Response, next: NextFunction) {
    try {
      const { from, to } = range(req);
      return ok(res, await dashboardPayments(ctxOf(req), from, to));
    } catch (e) {
      return next(e);
    }
  },

  async inventory(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await dashboardInventory(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async customers(req: Request, res: Response, next: NextFunction) {
    try {
      const { from, to } = range(req);
      return ok(res, await dashboardCustomers(ctxOf(req), from, to));
    } catch (e) {
      return next(e);
    }
  },

  async returns(req: Request, res: Response, next: NextFunction) {
    try {
      const { from, to } = range(req);
      return ok(res, await dashboardReturns(ctxOf(req), from, to));
    } catch (e) {
      return next(e);
    }
  },

  async topProducts(req: Request, res: Response, next: NextFunction) {
    try {
      const { from, to } = range(req);
      return ok(res, await dashboardTopProducts(ctxOf(req), from, to));
    } catch (e) {
      return next(e);
    }
  },

  async recentSales(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await dashboardRecentSales(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async activity(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await dashboardRecentActivity(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async topCustomers(req: Request, res: Response, next: NextFunction) {
    try {
      const { from, to } = range(req);
      return ok(res, await dashboardTopCustomers(ctxOf(req), from, to));
    } catch (e) {
      return next(e);
    }
  },

  async byCashier(req: Request, res: Response, next: NextFunction) {
    try {
      const { from, to } = range(req);
      return ok(res, await dashboardByCashier(ctxOf(req), from, to));
    } catch (e) {
      return next(e);
    }
  },

  async hourly(req: Request, res: Response, next: NextFunction) {
    try {
      const { from, to } = range(req);
      return ok(res, await dashboardHourly(ctxOf(req), from, to));
    } catch (e) {
      return next(e);
    }
  },
};
