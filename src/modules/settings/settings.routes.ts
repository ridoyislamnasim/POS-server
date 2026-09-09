import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { tenantId } from "../../lib/erp.js";
import type { AuthedRequest } from "../../types.js";

export const settingsRouter = Router();
settingsRouter.use(requireAuth, requireTenant, requirePermission("settings.manage"));

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

async function ensureSettings(tid: string) {
  return prisma.tenantSettings.upsert({
    where: { tenantId: tid },
    create: { tenantId: tid },
    update: {},
  });
}

settingsRouter.get("/", async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);
  const settings = await ensureSettings(tid);
  const templates = await prisma.invoiceTemplate.findMany({ where: { tenantId: tid } });
  const currencies = await prisma.currency.findMany({ where: { active: true } });
  const tax = await prisma.taxCategory.findMany({ where: { tenantId: tid } });
  return ok(res, { settings, templates, currencies, tax });
});

settingsRouter.patch("/", async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);
  await ensureSettings(tid);
  const b = req.body ?? {};
  const row = await prisma.tenantSettings.update({
    where: { tenantId: tid },
    data: {
      currency: b.currency,
      taxEnabled: b.taxEnabled,
      defaultTaxRate: b.defaultTaxRate != null ? String(b.defaultTaxRate) : undefined,
      invoiceTemplate: b.invoiceTemplate,
      receiptPrinter: b.receiptPrinter,
      barcodePrinter: b.barcodePrinter,
      paymentMethods: b.paymentMethods,
      notifications: b.notifications,
      language: b.language,
      theme: b.theme,
      lowStockThreshold: b.lowStockThreshold,
      whatsappEnabled: b.whatsappEnabled,
      smsEnabled: b.smsEnabled,
      emailEnabled: b.emailEnabled,
      invoiceFooter: b.invoiceFooter,
    },
  });
  return ok(res, row);
});

settingsRouter.post("/tax", async (req, res) => {
  const ctx = ctxOf(req);
  const { name, rate } = req.body ?? {};
  if (!name || rate == null) return fail(res, "VALIDATION", "name and rate required");
  const row = await prisma.taxCategory.create({
    data: { tenantId: tenantId(ctx), name, rate: String(rate) },
  });
  return ok(res, row, undefined, 201);
});

settingsRouter.post("/templates", async (req, res) => {
  const ctx = ctxOf(req);
  const { name, kind, body, isDefault } = req.body ?? {};
  if (!name || !kind || !body) return fail(res, "VALIDATION", "name, kind, body required");
  const row = await prisma.invoiceTemplate.create({
    data: { tenantId: tenantId(ctx), name, kind, body, isDefault: Boolean(isDefault) },
  });
  return ok(res, row, undefined, 201);
});

settingsRouter.get("/currencies", async (_req, res) => {
  return ok(res, await prisma.currency.findMany());
});

settingsRouter.post("/currencies", async (req, res) => {
  const { code, name, minorUnits } = req.body ?? {};
  if (!code || !name) return fail(res, "VALIDATION", "code and name required");
  const row = await prisma.currency.upsert({
    where: { code: String(code).toUpperCase() },
    create: { code: String(code).toUpperCase(), name, minorUnits: minorUnits ?? 2 },
    update: { name, active: true, minorUnits },
  });
  return ok(res, row);
});
