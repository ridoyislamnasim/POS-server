import type { NotificationType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export type NotificationAlertSettings = {
  inApp: boolean;
  lowStock: boolean;
  outOfStock: boolean;
  sales: boolean;
  returns: boolean;
  purchases: boolean;
  finance: boolean;
  staff: boolean;
  dailyClose: boolean;
  highValueSaleThreshold: number | null;
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  lowStockThreshold: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function flag(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

export function parseNotificationSettings(row: {
  notifications?: unknown;
  lowStockThreshold?: number | null;
  emailEnabled?: boolean | null;
  smsEnabled?: boolean | null;
  whatsappEnabled?: boolean | null;
} | null): NotificationAlertSettings {
  const notes = asRecord(row?.notifications);
  const alerts = asRecord(notes.alerts);
  const thresholdRaw = Number(alerts.highValueSaleThreshold ?? notes.highValueSaleThreshold);
  return {
    inApp: flag(alerts.inApp ?? notes.inApp, true),
    lowStock: flag(alerts.lowStock ?? notes.lowStock, true),
    outOfStock: flag(alerts.outOfStock ?? notes.outOfStock, true),
    sales: flag(alerts.sales ?? notes.sales, true),
    returns: flag(alerts.returns ?? notes.returns, true),
    purchases: flag(alerts.purchases ?? notes.purchases, true),
    finance: flag(alerts.finance ?? notes.finance, true),
    staff: flag(alerts.staff ?? notes.staff, true),
    dailyClose: flag(alerts.dailyClose ?? notes.dailyClose, true),
    highValueSaleThreshold: Number.isFinite(thresholdRaw) && thresholdRaw > 0 ? thresholdRaw : null,
    emailEnabled: Boolean(row?.emailEnabled),
    smsEnabled: Boolean(row?.smsEnabled),
    whatsappEnabled: Boolean(row?.whatsappEnabled),
    lowStockThreshold: row?.lowStockThreshold ?? 5,
  };
}

export async function loadNotificationSettings(tenantId: string) {
  const row = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  return parseNotificationSettings(row);
}

export function categoryEnabled(settings: NotificationAlertSettings, type: NotificationType) {
  switch (type) {
    case "LOW_STOCK":
      return settings.lowStock;
    case "OUT_OF_STOCK":
      return settings.outOfStock;
    case "SALE_COMPLETED":
    case "SALE_VOIDED":
      return settings.sales;
    case "SALE_RETURNED":
    case "RETURN_APPROVAL":
      return settings.returns;
    case "PURCHASE_CREATED":
    case "PURCHASE_RECEIVED":
    case "PURCHASE_CANCELLED":
      return settings.purchases;
    case "PAYMENT_RECEIVED":
    case "DUE_PAYMENT":
    case "EXPENSE_CREATED":
      return settings.finance;
    case "CASH_VARIANCE":
      return settings.dailyClose;
    case "STAFF_CREATED":
    case "STAFF_DEACTIVATED":
    case "ROLE_CHANGED":
    case "BRANCH_CHANGED":
      return settings.staff;
    case "SHIFT_ALERT":
    case "DAMAGE_SUBMITTED":
    case "DAMAGE_APPROVED":
    case "DAMAGE_REJECTED":
    case "SYSTEM_ALERT":
    case "BACKUP_SUCCESS":
    case "BACKUP_FAILED":
    case "MANUAL":
      return true;
    default:
      return true;
  }
}

export function mergeAlertFlags(
  currentNotes: Record<string, unknown>,
  incoming: Record<string, unknown>,
) {
  const next = { ...currentNotes, ...incoming };
  const keys = [
    "lowStock",
    "outOfStock",
    "sales",
    "returns",
    "purchases",
    "finance",
    "staff",
    "dailyClose",
    "inApp",
    "highValueSaleThreshold",
  ] as const;
  for (const key of keys) {
    if (incoming[key] !== undefined) next[key] = incoming[key];
  }
  return next;
}

export function safeActionUrl(raw?: string | null) {
  if (!raw) return null;
  const s = raw.trim();
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  if (s.includes("://") || s.includes("\\")) return null;
  if (/^javascript:/i.test(s) || /^data:/i.test(s)) return null;
  return s.slice(0, 500);
}
