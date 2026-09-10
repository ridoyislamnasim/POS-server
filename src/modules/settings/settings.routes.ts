import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { tenantId } from "../../lib/erp.js";
import { asJson } from "../../lib/http-errors.js";
import type { AuthedRequest } from "../../types.js";
import { mergeAlertFlags, parseNotificationSettings } from "../notifications/settings.js";

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
  const notes = settings.notifications && typeof settings.notifications === "object" && !Array.isArray(settings.notifications)
    ? (settings.notifications as Record<string, unknown>)
    : {};
  const receiptWidthMm = notes.receiptWidthMm === 58 || notes.receiptWidthMm === "58" ? 58 : 80;
  const defaultPrintType = notes.defaultPrintType === "a4" || notes.defaultPrintType === "invoice" ? "a4" : "thermal";
  const thankYouMessage = typeof notes.thankYouMessage === "string" ? notes.thankYouMessage : "Thank You!";
  const returnPolicy = typeof notes.returnPolicy === "string" ? notes.returnPolicy : "";
  const templates = await prisma.invoiceTemplate.findMany({ where: { tenantId: tid } });
  const currencies = await prisma.currency.findMany({ where: { active: true } });
  const tax = await prisma.taxCategory.findMany({ where: { tenantId: tid } });
  const alerts = parseNotificationSettings(settings);
  return ok(res, {
    settings: {
      ...settings,
      receiptWidthMm,
      defaultPrintType,
      thankYouMessage,
      returnPolicy,
      alertInApp: alerts.inApp,
      alertLowStock: alerts.lowStock,
      alertOutOfStock: alerts.outOfStock,
      alertSales: alerts.sales,
      alertReturns: alerts.returns,
      alertPurchases: alerts.purchases,
      alertFinance: alerts.finance,
      alertStaff: alerts.staff,
      alertDailyClose: alerts.dailyClose,
      highValueSaleThreshold: alerts.highValueSaleThreshold ?? "",
    },
    templates,
    currencies,
    tax,
  });
});

settingsRouter.patch("/", async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);
  const existing = await ensureSettings(tid);
  const b = req.body ?? {};
  const currentNotes =
    existing.notifications && typeof existing.notifications === "object" && !Array.isArray(existing.notifications)
      ? (existing.notifications as Record<string, unknown>)
      : {};
  const incomingNotes =
    b.notifications && typeof b.notifications === "object" && !Array.isArray(b.notifications)
      ? (b.notifications as Record<string, unknown>)
      : {};
  const width = b.receiptWidthMm === 58 || b.receiptWidthMm === "58" ? 58 : b.receiptWidthMm === 80 || b.receiptWidthMm === "80" ? 80 : currentNotes.receiptWidthMm;
  const defaultPrintType =
    b.defaultPrintType === "a4" || b.defaultPrintType === "invoice" || b.defaultPrintType === "thermal" || b.defaultPrintType === "receipt"
      ? b.defaultPrintType === "invoice"
        ? "a4"
        : b.defaultPrintType === "receipt"
          ? "thermal"
          : b.defaultPrintType
      : currentNotes.defaultPrintType;
  const thankYouMessage = b.thankYouMessage != null ? String(b.thankYouMessage) : currentNotes.thankYouMessage;
  const returnPolicy = b.returnPolicy != null ? String(b.returnPolicy) : currentNotes.returnPolicy;
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
      notifications: asJson(mergeAlertFlags(
        {
          ...currentNotes,
          ...incomingNotes,
          ...(width != null ? { receiptWidthMm: width } : {}),
          ...(defaultPrintType != null ? { defaultPrintType } : {}),
          ...(thankYouMessage != null ? { thankYouMessage } : {}),
          ...(returnPolicy != null ? { returnPolicy } : {}),
        },
        {
          inApp: b.alertInApp,
          lowStock: b.alertLowStock,
          outOfStock: b.alertOutOfStock,
          sales: b.alertSales,
          returns: b.alertReturns,
          purchases: b.alertPurchases,
          finance: b.alertFinance,
          staff: b.alertStaff,
          dailyClose: b.alertDailyClose,
          highValueSaleThreshold: b.highValueSaleThreshold === "" || b.highValueSaleThreshold == null ? undefined : Number(b.highValueSaleThreshold),
        },
      )),
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
  const ctx = ctxOf(req);
  const { code, name, minorUnits } = req.body ?? {};
  if (!code || !name) return fail(res, "VALIDATION", "code and name required");
  const normalized = String(code).toUpperCase();
  const existing = await prisma.currency.findUnique({ where: { code: normalized } });
  if (existing) {
    if (!ctx.isPlatform) return ok(res, existing);
    const row = await prisma.currency.update({
      where: { code: normalized },
      data: { name, active: true, minorUnits: minorUnits ?? existing.minorUnits },
    });
    return ok(res, row);
  }
  const row = await prisma.currency.create({
    data: { code: normalized, name, minorUnits: minorUnits ?? 2 },
  });
  return ok(res, row);
});
