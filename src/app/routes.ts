import type { Express } from "express";
import { authRouter } from "../modules/auth/auth.routes.js";
import { catalogRouter } from "../modules/catalog/catalog.routes.js";
import { salesRouter } from "../modules/sales/sales.routes.js";
import { shiftsRouter } from "../modules/shifts/shifts.routes.js";
import { usersRouter } from "../modules/users/users.routes.js";
import { documentsRouter } from "../modules/documents/documents.routes.js";
import { inventoryRouter } from "../modules/inventory/inventory.routes.js";
import { customersRouter } from "../modules/customers/customers.routes.js";
import { auditRouter } from "../modules/audit/audit.routes.js";
import { dashboardRouter } from "../modules/dashboard/dashboard.routes.js";
import { financeRouter } from "../modules/finance/finance.routes.js";
import { purchasesRouter } from "../modules/purchases/purchases.routes.js";
import { suppliersRouter } from "../modules/suppliers/suppliers.routes.js";
import { orgRouter } from "../modules/org/org.routes.js";
import { staffRouter } from "../modules/staff/staff.routes.js";
import { settingsRouter } from "../modules/settings/settings.routes.js";
import { saasRouter } from "../modules/saas/saas.routes.js";
import { commerceRouter } from "../modules/commerce/commerce.routes.js";
import { reportsRouter } from "../modules/reports/reports.routes.js";
import { extrasRouter } from "../modules/extras/extras.routes.js";
import { smsRouter } from "../modules/sms/sms.routes.js";
import { platformBillingRouter } from "../modules/platform-billing/billing.routes.js";
import { planRouter } from "../modules/plans/plan.routes.js";
import { tenantAccessRouter } from "../modules/tenant-access/tenant-access.routes.js";
import {
  tenantRequestRouter,
  platformRequestRouter,
  platformOverrideRouter,
} from "../modules/access-requests/access-request.routes.js";

/**
 * Single place where every module router is mounted.
 * Preserves the exact mount paths from the pre-refactor `app.ts`.
 */
export function registerRoutes(app: Express) {
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/catalog", catalogRouter);
  app.use("/api/v1/sales", salesRouter);
  app.use("/api/v1/shifts", shiftsRouter);
  app.use("/api/v1/users", usersRouter);
  app.use("/api/v1/inventory", inventoryRouter);
  app.use("/api/v1/dashboard", dashboardRouter);
  app.use("/api/v1/customers", customersRouter);
  app.use("/api/v1/audit", auditRouter);
  app.use("/api/v1/finance", financeRouter);
  app.use("/api/v1/purchases", purchasesRouter);
  app.use("/api/v1/suppliers", suppliersRouter);
  app.use("/api/v1/org", orgRouter);
  app.use("/api/v1/staff", staffRouter);
  app.use("/api/v1/settings", settingsRouter);
  app.use("/api/v1/saas", saasRouter);
  app.use("/api/v1/saas/access-requests", tenantRequestRouter);
  app.use("/api/v1/saas", tenantAccessRouter);
  app.use("/api/v1/platform-billing", platformBillingRouter);
  app.use("/api/v1/platform/plans", planRouter);
  app.use("/api/v1/platform/access-requests", platformRequestRouter);
  app.use("/api/v1/platform/tenant-overrides", platformOverrideRouter);
  app.use("/api/v1/commerce", commerceRouter);
  app.use("/api/v1/reports", reportsRouter);
  app.use("/api/v1/extras", extrasRouter);
  app.use("/api/v1/sms", smsRouter);
  app.use("/api/v1", documentsRouter);
}
