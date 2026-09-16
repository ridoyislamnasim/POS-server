import { Router } from "express";
import { fail } from "../../utils/response.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { ForbiddenError, assertBranch } from "../../lib/scope.js";
import { withBranchFilter } from "../../lib/erp.js";
import type { AuthedRequest } from "../../types.js";
import { dashboardController } from "./dashboard.controller.js";

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

dashboardRouter.get("/summary", dashboardController.summary);
dashboardRouter.get("/sales", dashboardController.sales);
dashboardRouter.get("/payments", dashboardController.payments);
dashboardRouter.get("/inventory", dashboardController.inventory);
dashboardRouter.get("/customers", dashboardController.customers);
dashboardRouter.get("/returns", dashboardController.returns);
dashboardRouter.get("/top-products", dashboardController.topProducts);
dashboardRouter.get("/recent-sales", dashboardController.recentSales);
dashboardRouter.get("/activity", dashboardController.activity);
dashboardRouter.get("/top-customers", dashboardController.topCustomers);
dashboardRouter.get("/by-cashier", dashboardController.byCashier);
dashboardRouter.get("/hourly", dashboardController.hourly);
