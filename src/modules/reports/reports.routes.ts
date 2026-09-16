import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { reportsController } from "./reports.controller.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireTenant, requirePermission("report.view"));

reportsRouter.get("/sales", reportsController.sales);
reportsRouter.get("/purchases", requirePermission("purchase.view"), reportsController.purchases);
reportsRouter.get("/inventory", requirePermission("inventory.view"), reportsController.inventory);
reportsRouter.get("/profit", requirePermission("report.finance"), reportsController.profit);
reportsRouter.get("/expenses", requirePermission("expense.view"), reportsController.expenses);
reportsRouter.get("/dues", requirePermission("finance.view"), reportsController.dues);
reportsRouter.get("/tax", requirePermission("report.finance"), reportsController.tax);
reportsRouter.get("/cashier", reportsController.cashier);
reportsRouter.get("/products", reportsController.products);
reportsRouter.get("/returns", requirePermission("sale.view"), reportsController.returns);
reportsRouter.get("/receiving", requirePermission("inventory.receive.view"), reportsController.receiving);
reportsRouter.get("/damage", requirePermission("inventory.damage.view"), reportsController.damage);
