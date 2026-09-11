import { Prisma, type SmsRecipientType, type SmsStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { hasPermission, requireTenantId } from "../../lib/scope.js";
import { acceptEnum, createdAtRange, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { validation, notFound } from "../../lib/http-errors.js";
import { writeAudit } from "../../lib/audit.js";
import { normalizeBdPhone } from "../../shared/phone.js";
import type { RequestContext } from "../../types.js";
import { decryptSecret, encryptSecret, publicSettingsMask } from "./sms.crypto.js";
import { fetchProviderBalance, sendViaProvider, type SmsProviderConfig } from "./sms.providers.js";
import {
  DEFAULT_SMS_TEMPLATES,
  isSmsTemplateKey,
  pickTemplateBody,
  renderSmsTemplate,
  type SmsTemplateKey,
  type SmsVars,
} from "./sms.templates.js";

const sendWindow = new Map<string, number[]>();
const NON_RETRYABLE = new Set([
  "provider_not_configured",
  "sms_disabled",
  "platform_disabled",
  "quota_exceeded",
  "no_credits",
  "invalid_phone",
  "no_phone",
  "template_disabled",
  "auto_send_disabled",
]);

export function smsTenantId(ctx: RequestContext) {
  return requireTenantId(ctx);
}

export function assertCanSendTo(ctx: RequestContext, recipientType: SmsRecipientType) {
  if (!hasPermission(ctx, "sms.send")) {
    throw Object.assign(new Error("Missing permission sms.send"), { code: "FORBIDDEN" });
  }
  if (recipientType === "SUPPLIER") {
    if (!hasPermission(ctx, "supplier.view") && !hasPermission(ctx, "purchase.view") && !hasPermission(ctx, "payment.manage")) {
      throw Object.assign(new Error("Supplier SMS requires supplier, purchase, or payment permission"), { code: "FORBIDDEN" });
    }
  }
  if (recipientType === "STAFF") {
    if (!hasPermission(ctx, "staff.view") && !hasPermission(ctx, "user.manage") && !hasPermission(ctx, "settings.manage")) {
      throw Object.assign(new Error("Staff SMS requires staff or settings permission"), { code: "FORBIDDEN" });
    }
  }
}

function checkSendRate(userId: string, limit = 30, windowMs = 60_000) {
  const now = Date.now();
  const hits = (sendWindow.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return false;
  hits.push(now);
  sendWindow.set(userId, hits);
  return true;
}

export function currentPeriod(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function money(n: unknown) {
  const v = Number(n ?? 0);
  return Number.isFinite(v) ? v.toFixed(2) : "0.00";
}

function todayLabel() {
  return new Date().toISOString().slice(0, 10);
}

export function publicSmsSettings(row: {
  provider: string;
  senderId: string | null;
  apiKeyEnc: string | null;
  apiSecretEnc: string | null;
  apiBaseUrl: string | null;
  extraConfigEnc?: string | null;
  defaultLanguage: string;
  autoSendEnabled: boolean;
  platformEnabled: boolean;
  monthlyQuota: number | null;
  creditsRemaining: number | null;
  lastBalance: Prisma.Decimal | number | null;
  lastBalanceCheckedAt: Date | null;
}) {
  return {
    provider: row.provider,
    senderId: row.senderId,
    apiBaseUrl: row.apiBaseUrl,
    defaultLanguage: row.defaultLanguage,
    autoSendEnabled: row.autoSendEnabled,
    platformEnabled: row.platformEnabled,
    monthlyQuota: row.monthlyQuota,
    creditsRemaining: row.creditsRemaining,
    lastBalance: row.lastBalance == null ? null : String(row.lastBalance),
    lastBalanceCheckedAt: row.lastBalanceCheckedAt,
    ...publicSettingsMask(Boolean(row.apiKeyEnc), Boolean(row.apiSecretEnc)),
  };
}

export async function ensureSmsSetup(tenantId: string) {
  const settings = await prisma.smsSettings.upsert({
    where: { tenantId },
    create: { tenantId },
    update: {},
  });
  const existing = await prisma.smsTemplate.findMany({ where: { tenantId }, select: { key: true } });
  const have = new Set(existing.map((t) => t.key));
  const missing = DEFAULT_SMS_TEMPLATES.filter((t) => !have.has(t.key));
  if (missing.length) {
    await prisma.smsTemplate.createMany({
      data: missing.map((t) => ({
        tenantId,
        key: t.key,
        name: t.name,
        purpose: t.purpose,
        recipientType: t.recipientType,
        bodyEn: t.bodyEn,
        bodyBn: t.bodyBn,
        enabled: t.enabled,
      })),
      skipDuplicates: true,
    });
  }
  return settings;
}

type Gate = { ok: true } | { ok: false; error: string; retryable: boolean };

export async function evaluateSmsGate(tenantId: string, opts: { automatic: boolean }): Promise<Gate & { settings?: Awaited<ReturnType<typeof ensureSmsSetup>> }> {
  const [tenant, shop, settings] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { smsAccessEnabled: true, name: true } }),
    prisma.tenantSettings.findUnique({ where: { tenantId }, select: { smsEnabled: true } }),
    ensureSmsSetup(tenantId),
  ]);
  if (!tenant?.smsAccessEnabled || !settings.platformEnabled) {
    return { ok: false, error: "platform_disabled", retryable: false };
  }
  if (!shop?.smsEnabled) {
    return { ok: false, error: "sms_disabled", retryable: false };
  }
  if (opts.automatic && !settings.autoSendEnabled) {
    return { ok: false, error: "auto_send_disabled", retryable: false };
  }
  if (settings.monthlyQuota != null) {
    const usage = await prisma.smsUsageMonth.findUnique({
      where: { tenantId_period: { tenantId, period: currentPeriod() } },
    });
    if ((usage?.sentCount ?? 0) >= settings.monthlyQuota) {
      return { ok: false, error: "quota_exceeded", retryable: false };
    }
  }
  if (settings.creditsRemaining != null && settings.creditsRemaining <= 0) {
    return { ok: false, error: "no_credits", retryable: false };
  }
  return { ok: true, settings };
}

export async function resolveShopName(tenantId: string) {
  const business = await prisma.business.findFirst({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
    select: { name: true },
  });
  if (business?.name) return business.name;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
  return tenant?.name ?? "Shop";
}

export async function getTemplate(tenantId: string, key: string) {
  await ensureSmsSetup(tenantId);
  return prisma.smsTemplate.findUnique({ where: { tenantId_key: { tenantId, key } } });
}

async function bumpUsage(tenantId: string, status: SmsStatus, previous?: SmsStatus | null) {
  const period = currentPeriod();
  const data =
    status === "SENT"
      ? { sentCount: { increment: 1 }, pendingCount: previous === "PENDING" || previous === "FAILED" ? { decrement: previous === "PENDING" ? 1 : 0 } : undefined }
      : status === "FAILED"
        ? { failedCount: { increment: 1 }, pendingCount: previous === "PENDING" ? { decrement: 1 } : undefined }
        : { pendingCount: { increment: 1 } };
  await prisma.smsUsageMonth.upsert({
    where: { tenantId_period: { tenantId, period } },
    create: {
      tenantId,
      period,
      sentCount: status === "SENT" ? 1 : 0,
      failedCount: status === "FAILED" ? 1 : 0,
      pendingCount: status === "PENDING" ? 1 : 0,
    },
    update: {
      sentCount: data.sentCount ?? undefined,
      failedCount: data.failedCount ?? undefined,
      pendingCount: data.pendingCount,
    },
  });
}

async function consumeCredit(tenantId: string) {
  await prisma.smsSettings.updateMany({
    where: { tenantId, creditsRemaining: { not: null } },
    data: { creditsRemaining: { decrement: 1 } },
  });
}

export type SendSmsInput = {
  tenantId: string;
  recipientType: SmsRecipientType;
  to: string;
  recipientName?: string | null;
  templateKey?: string | null;
  purpose?: string;
  language?: string;
  vars?: SmsVars;
  message?: string;
  sentByUserId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey: string;
  automatic?: boolean;
};

export async function sendTransactional(input: SendSmsInput) {
  const phone = normalizeBdPhone(input.to).trim();
  if (!phone) {
    return { skipped: true, error: "no_phone" as const };
  }
  const gate = await evaluateSmsGate(input.tenantId, { automatic: Boolean(input.automatic) });
  if (!gate.ok) {
    return { skipped: true, error: gate.error };
  }
  const settings = gate.settings!;
  let templateKey = input.templateKey ?? null;
  let purpose = input.purpose ?? "manual";
  let language = input.language || settings.defaultLanguage || "en";
  if (language !== "bn") language = "en";
  let message = (input.message ?? "").trim();

  if (templateKey) {
    if (!isSmsTemplateKey(templateKey) && !(await getTemplate(input.tenantId, templateKey))) {
      return { skipped: true, error: "unknown_template" };
    }
    const template = await getTemplate(input.tenantId, templateKey);
    if (!template) return { skipped: true, error: "unknown_template" };
    if (!template.enabled) return { skipped: true, error: "template_disabled" };
    purpose = template.purpose;
    if (!message) {
      message = renderSmsTemplate(pickTemplateBody(template, language), {
        shopName: await resolveShopName(input.tenantId),
        date: todayLabel(),
        phone,
        ...input.vars,
      });
    }
  }
  if (!message) return { skipped: true, error: "empty_message" };

  let log;
  try {
    log = await prisma.smsLog.create({
      data: {
        tenantId: input.tenantId,
        recipient: phone,
        recipientName: input.recipientName ?? null,
        recipientType: input.recipientType,
        message: message.slice(0, 2000),
        templateKey,
        purpose,
        language,
        sentByUserId: input.sentByUserId ?? null,
        status: "PENDING",
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null,
        idempotencyKey: input.idempotencyKey,
        provider: settings.provider,
      },
    });
    await bumpUsage(input.tenantId, "PENDING");
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.smsLog.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
      });
      if (!existing) return { skipped: true, error: "duplicate" };
      if (existing.status === "SENT") return { duplicate: true, log: existing };
      log = existing;
    } else {
      throw e;
    }
  }

  return deliverSmsLog(log.id, input.tenantId);
}

export async function deliverSmsLog(logId: string, tenantId: string) {
  const log = await prisma.smsLog.findFirst({ where: { id: logId, tenantId } });
  if (!log) return { skipped: true, error: "not_found" };
  if (log.status === "SENT") return { duplicate: true, log };

  const claimed = await prisma.smsLog.updateMany({
    where: { id: log.id, tenantId, status: { in: ["PENDING", "FAILED"] }, updatedAt: log.updatedAt },
    data: { status: "PENDING" },
  });
  if (claimed.count === 0) {
    const current = await prisma.smsLog.findFirst({ where: { id: log.id, tenantId } });
    if (current?.status === "SENT") return { duplicate: true, log: current };
  }

  const gate = await evaluateSmsGate(tenantId, { automatic: false });
  if (!gate.ok) {
    const updated = await prisma.smsLog.update({
      where: { id: log.id },
      data: {
        status: "FAILED",
        error: gate.error,
        retryable: false,
        attempts: { increment: 1 },
        providerResponse: gate.error,
      },
    });
    if (log.status !== "FAILED") await bumpUsage(tenantId, "FAILED", log.status);
    return { ok: false, log: updated, error: gate.error };
  }

  const result = await sendViaProvider(gate.settings!, log.recipient, log.message);
  const nextStatus: SmsStatus = result.ok ? "SENT" : "FAILED";
  const retryable = result.ok ? false : result.retryable && !NON_RETRYABLE.has(result.error ?? "");
  const updated = await prisma.smsLog.update({
    where: { id: log.id },
    data: {
      status: nextStatus,
      sentAt: result.ok ? new Date() : log.sentAt,
      provider: gate.settings!.provider,
      providerResponse: result.providerResponse.slice(0, 800),
      error: result.error ?? null,
      retryable,
      attempts: { increment: 1 },
    },
  });
  if (log.status !== nextStatus) await bumpUsage(tenantId, nextStatus, log.status);
  if (result.ok) await consumeCredit(tenantId);
  return { ok: result.ok, log: updated, error: result.error };
}

export async function previewSms(input: {
  tenantId: string;
  templateKey?: string;
  language?: string;
  message?: string;
  vars?: SmsVars;
}) {
  await ensureSmsSetup(input.tenantId);
  const settings = await prisma.smsSettings.findUnique({ where: { tenantId: input.tenantId } });
  const language = input.language || settings?.defaultLanguage || "en";
  const shopName = await resolveShopName(input.tenantId);
  const vars: SmsVars = { shopName, date: todayLabel(), ...input.vars };
  if (input.templateKey) {
    const template = await getTemplate(input.tenantId, input.templateKey);
    if (!template) notFound("Template not found");
    return {
      language,
      templateKey: template.key,
      enabled: template.enabled,
      message: renderSmsTemplate(pickTemplateBody(template, language), vars),
      bodyEn: renderSmsTemplate(template.bodyEn, vars),
      bodyBn: renderSmsTemplate(template.bodyBn, vars),
    };
  }
  const message = renderSmsTemplate(input.message ?? "", vars);
  return { language, templateKey: null, enabled: true, message, bodyEn: message, bodyBn: message };
}

export async function getDashboard(ctx: RequestContext) {
  const tenantId = smsTenantId(ctx);
  await ensureSmsSetup(tenantId);
  const period = currentPeriod();
  const [settings, tenant, shop, usage, sent, failed, pending, last] = await Promise.all([
    prisma.smsSettings.findUnique({ where: { tenantId } }),
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { smsAccessEnabled: true, smsAccessDisabledReason: true } }),
    prisma.tenantSettings.findUnique({ where: { tenantId }, select: { smsEnabled: true } }),
    prisma.smsUsageMonth.findUnique({ where: { tenantId_period: { tenantId, period } } }),
    prisma.smsLog.count({ where: { tenantId, status: "SENT" } }),
    prisma.smsLog.count({ where: { tenantId, status: "FAILED" } }),
    prisma.smsLog.count({ where: { tenantId, status: "PENDING" } }),
    prisma.smsLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        recipient: true,
        recipientType: true,
        purpose: true,
        status: true,
        createdAt: true,
        templateKey: true,
      },
    }),
  ]);
  return {
    access: {
      shopEnabled: Boolean(shop?.smsEnabled),
      platformEnabled: Boolean(settings?.platformEnabled && tenant?.smsAccessEnabled),
      autoSendEnabled: Boolean(settings?.autoSendEnabled),
      reason: tenant?.smsAccessDisabledReason ?? null,
    },
    usage: {
      period,
      sent: usage?.sentCount ?? 0,
      failed: usage?.failedCount ?? 0,
      pending: usage?.pendingCount ?? 0,
      lifetimeSent: sent,
      lifetimeFailed: failed,
      lifetimePending: pending,
      quota: settings?.monthlyQuota ?? null,
      creditsRemaining: settings?.creditsRemaining ?? null,
      lastBalance: settings?.lastBalance == null ? null : String(settings.lastBalance),
    },
    recent: last,
    settings: settings ? publicSmsSettings(settings) : null,
  };
}

export async function getSettings(ctx: RequestContext) {
  const tenantId = smsTenantId(ctx);
  const settings = await ensureSmsSetup(tenantId);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { smsAccessEnabled: true, smsAccessDisabledReason: true },
  });
  const shop = await prisma.tenantSettings.findUnique({ where: { tenantId }, select: { smsEnabled: true } });
  return {
    ...publicSmsSettings(settings),
    smsEnabled: Boolean(shop?.smsEnabled),
    smsAccessEnabled: Boolean(tenant?.smsAccessEnabled),
    smsAccessDisabledReason: tenant?.smsAccessDisabledReason ?? null,
  };
}

export async function updateSettings(ctx: RequestContext, body: Record<string, unknown>) {
  const tenantId = smsTenantId(ctx);
  const current = await ensureSmsSetup(tenantId);
  const provider = typeof body.provider === "string" ? body.provider.trim().slice(0, 40) : current.provider;
  const allowed = new Set(["GENERIC_HTTP", "CUSTOM", "BULKSMSBD", "SSL_WIRELESS", "TWILIO"]);
  if (!allowed.has(provider)) validation("Unsupported SMS provider");
  const language = body.defaultLanguage === "bn" ? "bn" : body.defaultLanguage === "en" ? "en" : current.defaultLanguage;
  const data: Prisma.SmsSettingsUpdateInput = {
    provider,
    senderId: body.senderId === undefined ? current.senderId : body.senderId ? String(body.senderId).slice(0, 40) : null,
    apiBaseUrl: body.apiBaseUrl === undefined ? current.apiBaseUrl : body.apiBaseUrl ? String(body.apiBaseUrl).slice(0, 300) : null,
    defaultLanguage: language,
    autoSendEnabled: body.autoSendEnabled == null ? current.autoSendEnabled : Boolean(body.autoSendEnabled),
    monthlyQuota: body.monthlyQuota === undefined ? current.monthlyQuota : body.monthlyQuota == null || body.monthlyQuota === "" ? null : Number(body.monthlyQuota),
    creditsRemaining:
      body.creditsRemaining === undefined
        ? current.creditsRemaining
        : body.creditsRemaining == null || body.creditsRemaining === ""
          ? null
          : Number(body.creditsRemaining),
  };
  if (typeof body.apiKey === "string" && body.apiKey.trim()) data.apiKeyEnc = encryptSecret(body.apiKey.trim());
  if (body.clearApiKey === true) data.apiKeyEnc = null;
  if (typeof body.apiSecret === "string" && body.apiSecret.trim()) data.apiSecretEnc = encryptSecret(body.apiSecret.trim());
  if (body.clearApiSecret === true) data.apiSecretEnc = null;
  if (body.extraConfig && typeof body.extraConfig === "object") {
    data.extraConfigEnc = encryptSecret(JSON.stringify(body.extraConfig));
  }
  if (body.clearExtraConfig === true) data.extraConfigEnc = null;
  const row = await prisma.smsSettings.update({ where: { tenantId }, data });
  if (body.smsEnabled != null) {
    await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId, smsEnabled: Boolean(body.smsEnabled) },
      update: { smsEnabled: Boolean(body.smsEnabled) },
    });
  }
  await writeAudit({
    ctx,
    action: "sms.settings.update",
    entityType: "SmsSettings",
    entityId: row.id,
    after: { provider: row.provider, autoSendEnabled: row.autoSendEnabled, hasApiKey: Boolean(row.apiKeyEnc) },
  });
  return getSettings(ctx);
}

export async function listTemplates(ctx: RequestContext) {
  const tenantId = smsTenantId(ctx);
  await ensureSmsSetup(tenantId);
  return prisma.smsTemplate.findMany({ where: { tenantId }, orderBy: [{ recipientType: "asc" }, { name: "asc" }] });
}

export async function updateTemplate(ctx: RequestContext, id: string, body: Record<string, unknown>) {
  const tenantId = smsTenantId(ctx);
  const row = await prisma.smsTemplate.findFirst({ where: { id, tenantId } });
  if (!row) notFound("Template not found");
  const updated = await prisma.smsTemplate.update({
    where: { id: row.id },
    data: {
      name: typeof body.name === "string" ? body.name.slice(0, 80) : row.name,
      bodyEn: typeof body.bodyEn === "string" ? body.bodyEn.slice(0, 1000) : row.bodyEn,
      bodyBn: typeof body.bodyBn === "string" ? body.bodyBn.slice(0, 1000) : row.bodyBn,
      enabled: body.enabled == null ? row.enabled : Boolean(body.enabled),
      customized: true,
    },
  });
  await writeAudit({ ctx, action: "sms.template.update", entityType: "SmsTemplate", entityId: updated.id, after: { key: updated.key, enabled: updated.enabled } });
  return updated;
}

export async function resetTemplate(ctx: RequestContext, id: string) {
  const tenantId = smsTenantId(ctx);
  const row = await prisma.smsTemplate.findFirst({ where: { id, tenantId } });
  if (!row) notFound("Template not found");
  const def = DEFAULT_SMS_TEMPLATES.find((t) => t.key === row.key);
  if (!def) validation("No default for this template");
  return prisma.smsTemplate.update({
    where: { id: row.id },
    data: {
      name: def.name,
      purpose: def.purpose,
      bodyEn: def.bodyEn,
      bodyBn: def.bodyBn,
      enabled: def.enabled,
      customized: false,
    },
  });
}

export async function listLogs(ctx: RequestContext, query: Record<string, unknown>) {
  const tenantId = smsTenantId(ctx);
  const list = parseListQuery(query, { sortable: ["createdAt", "status", "purpose"], defaultSort: "createdAt", defaultOrder: "desc" });
  const status = acceptEnum(query.status, ["PENDING", "SENT", "FAILED"] as const);
  const recipientType = acceptEnum(query.recipientType, ["CUSTOMER", "SUPPLIER", "STAFF"] as const);
  const purpose = typeof query.purpose === "string" && query.purpose && query.purpose !== "ALL" ? query.purpose.slice(0, 64) : undefined;
  const dates = createdAtRange(list);
  const q = list.search;
  const where: Prisma.SmsLogWhereInput = {
    tenantId,
    ...(status ? { status } : {}),
    ...(recipientType ? { recipientType } : {}),
    ...(purpose ? { purpose } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(q
      ? {
          OR: [
            { recipient: ilike(q) },
            { recipientName: ilike(q) },
            { message: ilike(q) },
            { purpose: ilike(q) },
            { templateKey: ilike(q) },
            { referenceId: ilike(q) },
          ],
        }
      : {}),
  };
  return withPagination(list, {
    find: (skip, take) =>
      prisma.smsLog.findMany({
        where,
        orderBy: list.sortBy === "status" || list.sortBy === "purpose" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.smsLog.count({ where }),
  });
}

export async function retryLog(ctx: RequestContext, id: string) {
  const tenantId = smsTenantId(ctx);
  const log = await prisma.smsLog.findFirst({ where: { id, tenantId } });
  if (!log) notFound("SMS log not found");
  if (log.status === "SENT") validation("SMS already sent");
  return deliverSmsLog(log.id, tenantId);
}

export async function getUsage(ctx: RequestContext) {
  const tenantId = smsTenantId(ctx);
  const settings = await ensureSmsSetup(tenantId);
  const months = await prisma.smsUsageMonth.findMany({
    where: { tenantId },
    orderBy: { period: "desc" },
    take: 12,
  });
  return {
    settings: publicSmsSettings(settings),
    months,
    period: currentPeriod(),
  };
}

export async function refreshBalance(ctx: RequestContext) {
  const tenantId = smsTenantId(ctx);
  const settings = await ensureSmsSetup(tenantId);
  const result = await fetchProviderBalance(settings);
  const updated = await prisma.smsSettings.update({
    where: { tenantId },
    data: {
      lastBalance: result.balance == null ? undefined : new Prisma.Decimal(result.balance),
      lastBalanceCheckedAt: new Date(),
    },
  });
  return { ...publicSmsSettings(updated), providerNote: result.raw };
}

export async function setPlatformAccess(input: {
  tenantId: string;
  enabled: boolean;
  reason?: string | null;
  actor: RequestContext;
}) {
  const tenant = await prisma.tenant.findUnique({ where: { id: input.tenantId }, select: { id: true } });
  if (!tenant) notFound("Tenant not found");
  await prisma.tenant.update({
    where: { id: input.tenantId },
    data: {
      smsAccessEnabled: input.enabled,
      smsAccessDisabledAt: input.enabled ? null : new Date(),
      smsAccessDisabledReason: input.enabled ? null : input.reason?.slice(0, 300) ?? "Disabled by platform",
    },
  });
  await ensureSmsSetup(input.tenantId);
  await prisma.smsSettings.update({
    where: { tenantId: input.tenantId },
    data: { platformEnabled: input.enabled },
  });
  await writeAudit({
    ctx: input.actor,
    action: "sms.platform.access",
    entityType: "Tenant",
    entityId: input.tenantId,
    after: { enabled: input.enabled, reason: input.reason ?? null },
  });
  return { tenantId: input.tenantId, enabled: input.enabled };
}

export async function resolveRecipient(
  tenantId: string,
  recipientType: SmsRecipientType,
  recipientId?: string | null,
  phone?: string | null,
) {
  if (recipientType === "CUSTOMER" && recipientId) {
    const row = await prisma.customer.findFirst({
      where: { id: recipientId, tenantId },
      select: { id: true, name: true, phone: true, phoneCanonical: true },
    });
    if (!row) notFound("Customer not found");
    return { id: row.id, name: row.name, phone: phone || row.phoneCanonical || row.phone };
  }
  if (recipientType === "SUPPLIER" && recipientId) {
    const row = await prisma.supplier.findFirst({
      where: { id: recipientId, tenantId },
      select: { id: true, name: true, phone: true },
    });
    if (!row) notFound("Supplier not found");
    return { id: row.id, name: row.name, phone: phone || row.phone || "" };
  }
  if (recipientType === "STAFF" && recipientId) {
    const row = await prisma.user.findFirst({
      where: { id: recipientId, tenants: { some: { tenantId } } },
      select: { id: true, name: true, phone: true },
    });
    if (!row) notFound("Staff not found");
    return { id: row.id, name: row.name, phone: phone || row.phone || "" };
  }
  if (phone) return { id: recipientId ?? null, name: null, phone };
  validation("Recipient phone required");
}

export async function sendManualSms(ctx: RequestContext, body: Record<string, unknown>) {
  const tenantId = smsTenantId(ctx);
  if (!checkSendRate(ctx.userId)) {
    throw Object.assign(new Error("Too many SMS. Try again shortly."), { code: "RATE_LIMIT" });
  }
  const recipientType = acceptEnum(body.recipientType, ["CUSTOMER", "SUPPLIER", "STAFF"] as const);
  if (!recipientType) validation("recipientType required");
  assertCanSendTo(ctx, recipientType);
  const party = await resolveRecipient(
    tenantId,
    recipientType,
    typeof body.recipientId === "string" ? body.recipientId : null,
    typeof body.to === "string" ? body.to : typeof body.phone === "string" ? body.phone : null,
  );
  const templateKey = typeof body.templateKey === "string" ? body.templateKey : recipientType === "SUPPLIER" ? "MANUAL_SUPPLIER" : recipientType === "STAFF" ? "STAFF_ALERT" : "MANUAL_CUSTOMER";
  const vars = (body.vars && typeof body.vars === "object" ? body.vars : {}) as SmsVars;
  const result = await sendTransactional({
    tenantId,
    recipientType,
    to: party.phone,
    recipientName: party.name,
    templateKey,
    purpose: "manual",
    language: typeof body.language === "string" ? body.language : undefined,
    vars: {
      customerName: recipientType === "CUSTOMER" ? party.name : vars.customerName,
      supplierName: recipientType === "SUPPLIER" ? party.name : vars.supplierName,
      staffName: recipientType === "STAFF" ? party.name : vars.staffName,
      ...vars,
    },
    message: typeof body.message === "string" ? body.message : undefined,
    sentByUserId: ctx.userId,
    referenceType: typeof body.referenceType === "string" ? body.referenceType : null,
    referenceId: typeof body.referenceId === "string" ? body.referenceId : null,
    idempotencyKey: typeof body.idempotencyKey === "string" && body.idempotencyKey
      ? body.idempotencyKey.slice(0, 120)
      : `manual:${ctx.userId}:${Date.now()}:${party.phone}`,
    automatic: false,
  });
  if ("skipped" in result && result.skipped) {
    const reasons: Record<string, string> = {
      sms_disabled: "SMS is disabled for this shop",
      platform_disabled: "SMS is disabled for this tenant",
      no_phone: "Recipient has no phone number",
      empty_message: "Message is empty",
      template_disabled: "This template is disabled",
      quota_exceeded: "Monthly SMS quota reached",
      no_credits: "SMS credits are exhausted",
      provider_not_configured: "SMS provider is not configured",
    };
    validation(reasons[result.error ?? ""] ?? result.error ?? "SMS was not sent");
  }
  await writeAudit({
    ctx,
    action: "sms.send",
    entityType: "SmsLog",
    after: { recipientType, to: party.phone, templateKey },
  });
  return result;
}

export function providerConfigFrom(row: {
  provider: string;
  senderId: string | null;
  apiKeyEnc: string | null;
  apiSecretEnc: string | null;
  apiBaseUrl: string | null;
  extraConfigEnc: string | null;
}): SmsProviderConfig {
  return row;
}

export { money, todayLabel };

export const SMS_TEMPLATE_KEYS: SmsTemplateKey[] = DEFAULT_SMS_TEMPLATES.map((t) => t.key);
