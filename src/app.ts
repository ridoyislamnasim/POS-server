import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { prisma } from "./lib/prisma.js";
import { fail, ok } from "./lib/envelope.js";
import { pingRedis, redisRequired } from "./lib/redis.js";
import { requestContext } from "./middleware/request-id.js";
import { csrfProtect } from "./middleware/csrf.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { catalogRouter } from "./modules/catalog/catalog.routes.js";
import { salesRouter } from "./modules/sales/sales.routes.js";
import { shiftsRouter } from "./modules/shifts/shifts.routes.js";
import { usersRouter } from "./modules/users/users.routes.js";
import { documentsRouter } from "./modules/documents/documents.routes.js";
import { inventoryRouter } from "./modules/inventory/inventory.routes.js";
import { customersRouter } from "./modules/customers/customers.routes.js";
import { auditRouter } from "./modules/audit/audit.routes.js";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.js";
import { financeRouter } from "./modules/finance/finance.routes.js";
import { purchasesRouter } from "./modules/purchases/purchases.routes.js";
import { suppliersRouter } from "./modules/suppliers/suppliers.routes.js";
import { orgRouter } from "./modules/org/org.routes.js";
import { staffRouter } from "./modules/staff/staff.routes.js";
import { settingsRouter } from "./modules/settings/settings.routes.js";
import { saasRouter } from "./modules/saas/saas.routes.js";
import { commerceRouter } from "./modules/commerce/commerce.routes.js";
import { reportsRouter } from "./modules/reports/reports.routes.js";
import { extrasRouter } from "./modules/extras/extras.routes.js";
import { smsRouter } from "./modules/sms/sms.routes.js";
import { platformBillingRouter } from "./modules/platform-billing/billing.routes.js";

const originAllowlist = (process.env.WEB_ORIGIN ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function createApp() {
  const app = express();
  app.use(requestContext);
  app.use(
    cors({
      origin: originAllowlist,
      credentials: true,
      exposedHeaders: ["Content-Disposition"],
    }),
  );
  app.use(express.json({ limit: "12mb" }));
  app.use(cookieParser());
  app.use(csrfProtect);
  const uploadRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads");
  app.use("/uploads", express.static(uploadRoot, { index: false, dotfiles: "deny" }));

  app.get("/api/health", (_req, res) => ok(res, { status: "ok" }));
  app.get("/api/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return fail(res, "NOT_READY", "PostgreSQL unavailable", 503);
    }
    const redisOk = await pingRedis();
    if (redisRequired() && !redisOk) {
      return fail(res, "NOT_READY", "Redis unavailable", 503);
    }
    return ok(res, { db: true, redis: redisOk });
  });

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
  app.use("/api/v1/platform-billing", platformBillingRouter);
  app.use("/api/v1/commerce", commerceRouter);
  app.use("/api/v1/reports", reportsRouter);
  app.use("/api/v1/extras", extrasRouter);
  app.use("/api/v1/sms", smsRouter);
  app.use("/api/v1", documentsRouter);

  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Not found" } });
  });
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    if (res.headersSent) return;
    const exposed = process.env.NODE_ENV === "production" ? "Unexpected error" : err.message || "Unexpected error";
    return fail(res, "INTERNAL", exposed, 500);
  });
  return app;
}
