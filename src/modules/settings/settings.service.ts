import { asJson } from "../../lib/http-errors.js";
import { tenantId } from "../../lib/erp.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { mergeAlertFlags, parseNotificationSettings } from "../notifications/settings.js";
import { settingsRepository } from "./settings.repository.js";
import type {
  CreateCurrencyInput,
  CreateTaxInput,
  CreateTemplateInput,
  UpdateSettingsInput,
} from "./settings.types.js";

/** Settings business logic. No Express `req`/`res` here. */
export const settingsService = {
  async get(ctx: RequestContext) {
    const tid = tenantId(ctx);
    const settings = await settingsRepository.ensureSettings(tid);
    const notes =
      settings.notifications && typeof settings.notifications === "object" && !Array.isArray(settings.notifications)
        ? (settings.notifications as Record<string, unknown>)
        : {};
    const receiptWidthMm = notes.receiptWidthMm === 58 || notes.receiptWidthMm === "58" ? 58 : 80;
    const defaultPrintType = notes.defaultPrintType === "a4" || notes.defaultPrintType === "invoice" ? "a4" : "thermal";
    const thankYouMessage = typeof notes.thankYouMessage === "string" ? notes.thankYouMessage : "Thank You!";
    const returnPolicy = typeof notes.returnPolicy === "string" ? notes.returnPolicy : "";
    const [templates, currencies, tax] = await Promise.all([
      settingsRepository.listTemplates(tid),
      settingsRepository.listActiveCurrencies(),
      settingsRepository.listTaxCategories(tid),
    ]);
    const alerts = parseNotificationSettings(settings);
    return {
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
    };
  },

  async update(ctx: RequestContext, input: UpdateSettingsInput) {
    const tid = tenantId(ctx);
    const existing = await settingsRepository.ensureSettings(tid);
    const b = input;
    const currentNotes =
      existing.notifications && typeof existing.notifications === "object" && !Array.isArray(existing.notifications)
        ? (existing.notifications as Record<string, unknown>)
        : {};
    const incomingNotes =
      b.notifications && typeof b.notifications === "object" && !Array.isArray(b.notifications)
        ? (b.notifications as Record<string, unknown>)
        : {};
    const raw = b as Record<string, unknown>;
    const width =
      raw.receiptWidthMm === 58 || raw.receiptWidthMm === "58"
        ? 58
        : raw.receiptWidthMm === 80 || raw.receiptWidthMm === "80"
          ? 80
          : currentNotes.receiptWidthMm;
    const defaultPrintType =
      raw.defaultPrintType === "a4" || raw.defaultPrintType === "invoice" || raw.defaultPrintType === "thermal" || raw.defaultPrintType === "receipt"
        ? raw.defaultPrintType === "invoice"
          ? "a4"
          : raw.defaultPrintType === "receipt"
            ? "thermal"
            : raw.defaultPrintType
        : currentNotes.defaultPrintType;
    const thankYouMessage = raw.thankYouMessage != null ? String(raw.thankYouMessage) : currentNotes.thankYouMessage;
    const returnPolicy = raw.returnPolicy != null ? String(raw.returnPolicy) : currentNotes.returnPolicy;
    return settingsRepository.updateSettings(tid, {
      currency: raw.currency,
      taxEnabled: raw.taxEnabled,
      defaultTaxRate: raw.defaultTaxRate != null ? String(raw.defaultTaxRate) : undefined,
      invoiceTemplate: raw.invoiceTemplate,
      receiptPrinter: raw.receiptPrinter,
      barcodePrinter: raw.barcodePrinter,
      paymentMethods: raw.paymentMethods,
      notifications: asJson(
        mergeAlertFlags(
          {
            ...currentNotes,
            ...incomingNotes,
            ...(width != null ? { receiptWidthMm: width } : {}),
            ...(defaultPrintType != null ? { defaultPrintType } : {}),
            ...(thankYouMessage != null ? { thankYouMessage } : {}),
            ...(returnPolicy != null ? { returnPolicy } : {}),
          },
          {
            inApp: raw.alertInApp as boolean | undefined,
            lowStock: raw.alertLowStock as boolean | undefined,
            outOfStock: raw.alertOutOfStock as boolean | undefined,
            sales: raw.alertSales as boolean | undefined,
            returns: raw.alertReturns as boolean | undefined,
            purchases: raw.alertPurchases as boolean | undefined,
            finance: raw.alertFinance as boolean | undefined,
            staff: raw.alertStaff as boolean | undefined,
            dailyClose: raw.alertDailyClose as boolean | undefined,
            highValueSaleThreshold:
              raw.highValueSaleThreshold === "" || raw.highValueSaleThreshold == null
                ? undefined
                : Number(raw.highValueSaleThreshold),
          },
        ),
      ),
      language: raw.language,
      theme: raw.theme,
      lowStockThreshold: raw.lowStockThreshold,
      whatsappEnabled: raw.whatsappEnabled,
      smsEnabled: raw.smsEnabled,
      emailEnabled: raw.emailEnabled,
      invoiceFooter: raw.invoiceFooter,
    });
  },

  async createTax(ctx: RequestContext, input: CreateTaxInput) {
    if (!input.name || input.rate == null) throw new AppError("VALIDATION", "name and rate required", 400);
    return settingsRepository.createTax(tenantId(ctx), input.name, String(input.rate));
  },

  async createTemplate(ctx: RequestContext, input: CreateTemplateInput) {
    if (!input.name || !input.kind || !input.body) {
      throw new AppError("VALIDATION", "name, kind, body required", 400);
    }
    return settingsRepository.createTemplate(tenantId(ctx), {
      name: input.name,
      kind: input.kind,
      body: input.body,
      isDefault: Boolean(input.isDefault),
    });
  },

  listCurrencies() {
    return settingsRepository.listAllCurrencies();
  },

  async createCurrency(ctx: RequestContext, input: CreateCurrencyInput) {
    if (!input.code || !input.name) throw new AppError("VALIDATION", "code and name required", 400);
    const normalized = String(input.code).toUpperCase();
    const existing = await settingsRepository.findCurrency(normalized);
    if (existing) {
      if (!ctx.isPlatform) return existing;
      return settingsRepository.updateCurrency(normalized, {
        name: input.name,
        minorUnits: input.minorUnits ?? existing.minorUnits,
      });
    }
    return settingsRepository.createCurrency({
      code: normalized,
      name: input.name,
      minorUnits: input.minorUnits ?? 2,
    });
  },
};
