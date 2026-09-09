import { Router } from "express";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { ForbiddenError, assertBranch } from "../../lib/scope.js";
import { withBranchFilter } from "../../lib/erp.js";
import type { AuthedRequest } from "../../types.js";
import {
  dashboardByCashier,
  dashboardCustomers,
  dashboardHourly,
  dashboardInventory,
  dashboardRecentActivity,
  dashboardRecentSales,
  dashboardReturns,
  dashboardSales,
  dashboardSummary,
  dashboardTopCustomers,
  dashboardTopProducts,
  periodRange,
} from "./dashboard.service.js";

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requireTenant, requirePermission("report.view"));
dashboardRouter.use((req, res, next) => {
  try {
    const branchId = req.query.branchId ? String(req.query.branchId) : "";
    if (branchId) {
      const authed = req as AuthedRequest;
      assertBranch(authed.ctx, branchId);
      authed.ctx = withBranchFilter(authed.ctx, branchId);
    }
    next();
  } catch (e) {
    if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", (e as Error).message, 403);
    next(e);
  }
});

function range(req: AuthedRequest) {
  const period = String(req.query.period ?? "today");
  const ctx = req.ctx;
  const computed = periodRange(period, ctx.businessDate);
  const from = String(req.query.from ?? computed.from);
  const to = String(req.query.to ?? computed.to);
  return { period, from, to };
}

dashboardRouter.get("/summary", async (req, res) => {
  const { from, to } = range(req as AuthedRequest);
  return ok(res, await dashboardSummary((req as AuthedRequest).ctx, from, to));
});

dashboardRouter.get("/sales", async (req, res) => {
  const period = String(req.query.period ?? "today");
  return ok(res, await dashboardSales((req as AuthedRequest).ctx, period));
});

dashboardRouter.get("/inventory", async (req, res) => {
  return ok(res, await dashboardInventory((req as AuthedRequest).ctx));
});

dashboardRouter.get("/customers", async (req, res) => {
  const { from, to } = range(req as AuthedRequest);
  return ok(res, await dashboardCustomers((req as AuthedRequest).ctx, from, to));
});

dashboardRouter.get("/returns", async (req, res) => {
  const { from, to } = range(req as AuthedRequest);
  return ok(res, await dashboardReturns((req as AuthedRequest).ctx, from, to));
});

dashboardRouter.get("/top-products", async (req, res) => {
  const { from, to } = range(req as AuthedRequest);
  return ok(res, await dashboardTopProducts((req as AuthedRequest).ctx, from, to));
});

dashboardRouter.get("/recent-sales", async (req, res) => {
  return ok(res, await dashboardRecentSales((req as AuthedRequest).ctx));
});

dashboardRouter.get("/activity", async (req, res) => {
  return ok(res, await dashboardRecentActivity((req as AuthedRequest).ctx));
});

dashboardRouter.get("/top-customers", async (req, res) => {
  const { from, to } = range(req as AuthedRequest);
  return ok(res, await dashboardTopCustomers((req as AuthedRequest).ctx, from, to));
});

dashboardRouter.get("/by-cashier", async (req, res) => {
  const { from, to } = range(req as AuthedRequest);
  return ok(res, await dashboardByCashier((req as AuthedRequest).ctx, from, to));
});

dashboardRouter.get("/hourly", async (req, res) => {
  const { from, to } = range(req as AuthedRequest);
  return ok(res, await dashboardHourly((req as AuthedRequest).ctx, from, to));
});
