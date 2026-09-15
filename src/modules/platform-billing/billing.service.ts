import type { PlatformInvoice, PlatformInvoiceStatus, Prisma, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { processOutboxBatch } from "../outbox/worker.js";
import type { RequestContext } from "../../types.js";
import { createdAtRange, parseListQuery, withPagination } from "../../lib/list-query.js";
import { PAYMENT_REQUIRED_MESSAGE } from "../../middleware/auth.js";

const invoiceInclude = {
  tenant: { include: { businesses: true, plan: true } },
  events: { orderBy: { createdAt: "desc" as const }, take: 20 },
} satisfies Prisma.PlatformInvoiceInclude;

export type InvoiceWithRelations = Prisma.PlatformInvoiceGetPayload<{ include: typeof invoiceInclude }>;

function asDate(value: unknown, fallback?: Date) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

function previousMonthRange(now = new Date()) {
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 23, 59, 59, 999));
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1, 0, 0, 0, 0));
  const dueDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 7, 23, 59, 59, 999));
  return { periodStart, periodEnd, dueDate };
}

export async function nextPlatformInvoiceNumber() {
  const ym = new Date().toISOString().slice(0, 7).replace("-", "");
  const prefix = `PLAT-${ym}-`;
  const last = await prisma.platformInvoice.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const n = last ? Number(last.number.slice(prefix.length)) + 1 : 1;
  const next = Number.isFinite(n) && n > 0 ? n : 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export async function syncOverdueInvoices(tenantId?: string) {
  const where: Prisma.PlatformInvoiceWhereInput = {
    status: "PENDING",
    dueDate: { lt: new Date() },
    ...(tenantId ? { tenantId } : {}),
  };
  const stale = await prisma.platformInvoice.findMany({ where, select: { id: true, tenantId: true } });
  if (!stale.length) return 0;
  await prisma.platformInvoice.updateMany({ where: { id: { in: stale.map((r) => r.id) } }, data: { status: "OVERDUE" } });
  await prisma.platformInvoiceEvent.createMany({
    data: stale.map((row) => ({
      invoiceId: row.id,
      tenantId: row.tenantId,
      type: "STATUS",
      note: "Auto-marked OVERDUE",
    })),
  });
  return stale.length;
}

async function recordEvent(input: {
  invoiceId?: string | null;
  tenantId: string;
  type: string;
  note?: string;
  actorId?: string;
}) {
  return prisma.platformInvoiceEvent.create({
    data: {
      invoiceId: input.invoiceId ?? undefined,
      tenantId: input.tenantId,
      type: input.type,
      note: input.note,
      actorId: input.actorId,
    },
  });
}

export function serializeInvoice(row: PlatformInvoice | InvoiceWithRelations) {
  return {
    ...row,
    amount: String(row.amount),
    subtotal: row.subtotal != null ? String(row.subtotal) : null,
    discountValue: String((row as { discountValue?: unknown }).discountValue ?? 0),
    discountAmount: String((row as { discountAmount?: unknown }).discountAmount ?? 0),
  };
}

export type TenantDiscountType = "NONE" | "PERCENT" | "FLAT";

export function parseDiscountType(value: unknown): TenantDiscountType {
  const s = String(value ?? "NONE").toUpperCase();
  if (s === "PERCENT" || s === "%") return "PERCENT";
  if (s === "FLAT" || s === "AMOUNT" || s === "FIXED") return "FLAT";
  return "NONE";
}

export function parseDiscountValue(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function calcDiscountAmount(subtotal: number, type: TenantDiscountType, value: number) {
  const base = Number.isFinite(subtotal) && subtotal > 0 ? subtotal : 0;
  if (type === "PERCENT") {
    const pct = Math.min(100, Math.max(0, value));
    return Math.min(base, (base * pct) / 100);
  }
  if (type === "FLAT") return Math.min(base, Math.max(0, value));
  return 0;
}

function normalizeTenantDiscount(body: Record<string, unknown>) {
  const type = parseDiscountType(body.discountType);
  let value = parseDiscountValue(body.discountValue ?? body.discountPercent ?? body.discountAmount);
  if (type === "PERCENT") value = Math.min(100, value);
  if (type === "NONE") value = 0;
  const reason = body.discountReason != null && String(body.discountReason).trim() ? String(body.discountReason).trim().slice(0, 200) : null;
  return { type, value, reason };
}

export async function listPlatformTenants(query: Record<string, unknown>) {
  await syncOverdueInvoices();
  const list = parseListQuery(query, { sortable: ["name", "createdAt"], defaultSort: "name", defaultOrder: "asc" });
  const q = list.search;
  const where: Prisma.TenantWhereInput = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { id: q }] }
    : {};
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.tenant.findMany({
        where,
        orderBy: list.sortBy === "createdAt" ? { createdAt: list.sortOrder } : { name: list.sortOrder },
        skip,
        take,
        include: {
          plan: true,
          _count: { select: { platformInvoices: true } },
        },
      }),
    count: () => prisma.tenant.count({ where }),
  });
  const ids = rows.map((t) => t.id);
  const unpaid = ids.length
    ? await prisma.platformInvoice.groupBy({
        by: ["tenantId", "status"],
        where: { tenantId: { in: ids }, status: { in: ["PENDING", "OVERDUE"] } },
        _count: { _all: true },
        _sum: { amount: true },
      })
    : [];
  const unpaidByTenant = new Map<string, { unpaidCount: number; overdueCount: number; unpaidAmount: string }>();
  for (const row of unpaid) {
    const cur = unpaidByTenant.get(row.tenantId) ?? { unpaidCount: 0, overdueCount: 0, unpaidAmount: "0" };
    cur.unpaidCount += row._count._all;
    if (row.status === "OVERDUE") cur.overdueCount += row._count._all;
    cur.unpaidAmount = String(Number(cur.unpaidAmount) + Number(row._sum.amount ?? 0));
    unpaidByTenant.set(row.tenantId, cur);
  }
  return {
    rows: rows.map((t) => ({
      id: t.id,
      name: t.name,
      country: t.country,
      subscriptionStatus: t.subscriptionStatus,
      apiAccessEnabled: t.apiAccessEnabled,
      apiAccessDisabledAt: t.apiAccessDisabledAt,
      apiAccessDisabledReason: t.apiAccessDisabledReason,
      trialEnd: t.trialEnd,
      discountType: (t as { discountType?: string }).discountType ?? "NONE",
      discountValue: String((t as { discountValue?: unknown }).discountValue ?? 0),
      discountReason: (t as { discountReason?: string | null }).discountReason ?? null,
      plan: t.plan ? { id: t.plan.id, name: t.plan.name, code: t.plan.code, price: String(t.plan.price), currency: t.plan.currency } : null,
      invoiceCount: t._count.platformInvoices,
      unpaidCount: unpaidByTenant.get(t.id)?.unpaidCount ?? 0,
      overdueCount: unpaidByTenant.get(t.id)?.overdueCount ?? 0,
      unpaidAmount: unpaidByTenant.get(t.id)?.unpaidAmount ?? "0",
    })),
    pagination,
  };
}

export async function getPlatformTenant(id: string) {
  await syncOverdueInvoices(id);
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: { plan: true, businesses: true, settings: true },
  });
  if (!tenant) return null;
  const invoices = await prisma.platformInvoice.findMany({
    where: { tenantId: id },
    orderBy: { createdAt: "desc" },
  });
  return {
    tenant: {
      ...tenant,
      plan: tenant.plan
        ? { ...tenant.plan, price: String(tenant.plan.price) }
        : null,
    },
    invoices: invoices.map(serializeInvoice),
  };
}

const SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "TRIAL",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
  "SUSPENDED",
  "CANCELLED",
  "EXPIRED",
];

type TenantWithPlan = Prisma.TenantGetPayload<{ include: { plan: true } }>;

function serializeTenantRow(t: TenantWithPlan) {
  return {
    id: t.id,
    name: t.name,
    country: t.country,
    subscriptionStatus: t.subscriptionStatus,
    apiAccessEnabled: t.apiAccessEnabled,
    apiAccessDisabledAt: t.apiAccessDisabledAt,
    apiAccessDisabledReason: t.apiAccessDisabledReason,
    trialEnd: t.trialEnd,
    discountType: (t as { discountType?: string }).discountType ?? "NONE",
    discountValue: String((t as { discountValue?: unknown }).discountValue ?? 0),
    discountReason: (t as { discountReason?: string | null }).discountReason ?? null,
    plan: t.plan
      ? { id: t.plan.id, name: t.plan.name, code: t.plan.code, price: String(t.plan.price), currency: t.plan.currency }
      : null,
    invoiceCount: 0,
    unpaidCount: 0,
    overdueCount: 0,
    unpaidAmount: "0",
  };
}

export async function createTenant(ctx: RequestContext, body: Record<string, unknown>) {
  const name = String(body.name ?? "").trim();
  if (!name) throw Object.assign(new Error("name required"), { code: "VALIDATION" });

  const country = (String(body.country ?? "BD").trim() || "BD").toUpperCase().slice(0, 2);
  const timezone = String(body.timezone ?? "Asia/Dhaka").trim() || "Asia/Dhaka";
  const locale = String(body.locale ?? "en").trim().slice(0, 5) || "en";
  const industryPack = String(body.industryPack ?? "FASHION").trim().toUpperCase() || "FASHION";

  const plan = body.planId
    ? await prisma.plan.findFirst({ where: { id: String(body.planId), active: true } })
    : null;
  if (body.planId && !plan) throw Object.assign(new Error("Plan not found"), { code: "NOT_FOUND" });

  const rawStatus = String(body.subscriptionStatus ?? "TRIAL").toUpperCase() as SubscriptionStatus;
  const subscriptionStatus = SUBSCRIPTION_STATUSES.includes(rawStatus) ? rawStatus : "TRIAL";

  const trialStart = asDate(body.trialStart, subscriptionStatus === "TRIAL" ? new Date() : undefined);
  const trialEnd = asDate(body.trialEnd);

  const discount = normalizeTenantDiscount(body);
  if (discount.type === "PERCENT" && discount.value > 100) {
    throw Object.assign(new Error("discount percent must be 0-100"), { code: "VALIDATION" });
  }

  const branchName = String(body.branchName ?? "").trim() || name;
  const branchCode = (String(body.branchCode ?? "").trim() || "MAIN").toUpperCase().slice(0, 8);

  const tenant = await prisma.$transaction(async (tx) => {
    const row = await tx.tenant.create({
      data: {
        name,
        industryPack,
        country,
        timezone,
        locale,
        planId: plan?.id ?? null,
        subscriptionStatus,
        trialStart,
        trialEnd,
        apiAccessEnabled: true,
        discountType: discount.type,
        discountValue: discount.value.toFixed(4),
        discountReason: discount.reason,
      },
      include: { plan: true },
    });

    await tx.business.create({
      data: { tenantId: row.id, name, currency: plan?.currency ?? "BDT" },
    });

    const loc = await tx.location.create({
      data: { tenantId: row.id, type: "STORE", name: `${branchName} Floor` },
    });
    await tx.stockLocationChannel.create({
      data: { tenantId: row.id, locationId: loc.id, channel: "STORE" },
    });
    const branch = await tx.branch.create({
      data: { tenantId: row.id, locationId: loc.id, name: branchName, code: branchCode },
    });
    await tx.register.create({
      data: { tenantId: row.id, branchId: branch.id, name: "Register 01" },
    });
    const year = new Date().getFullYear();
    await tx.documentNumberSequence.create({
      data: {
        tenantId: row.id,
        branchId: branch.id,
        documentType: "INVOICE",
        fiscalYear: year,
        prefix: `${branchCode}-INV-${year}-`,
      },
    });

    await tx.tenantSettings.create({
      data: { tenantId: row.id, currency: plan?.currency ?? "BDT" },
    });

    return row;
  });

  await writeAudit({
    ctx,
    action: "platform.tenant.create",
    entityType: "Tenant",
    entityId: tenant.id,
    after: { name, country, planId: plan?.id, subscriptionStatus, trialEnd, discountType: discount.type, discountValue: discount.value },
  });

  return serializeTenantRow(tenant);
}

export async function updateTenant(ctx: RequestContext, id: string, body: Record<string, unknown>) {
  const existing = await prisma.tenant.findUnique({ where: { id }, include: { plan: true } });
  if (!existing) throw Object.assign(new Error("Tenant not found"), { code: "NOT_FOUND" });

  const data: Prisma.TenantUpdateInput = {};
  const before: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = String(body.name ?? "").trim();
    if (!name) throw Object.assign(new Error("name required"), { code: "VALIDATION" });
    if (name !== existing.name) {
      before.name = existing.name;
      data.name = name;
    }
  }

  if (body.country !== undefined) {
    const country = (String(body.country ?? "").trim() || "BD").toUpperCase().slice(0, 2);
    if (country !== existing.country) {
      before.country = existing.country;
      data.country = country;
    }
  }

  if (body.subscriptionStatus !== undefined) {
    const raw = String(body.subscriptionStatus).toUpperCase() as SubscriptionStatus;
    const subscriptionStatus = SUBSCRIPTION_STATUSES.includes(raw) ? raw : undefined;
    if (subscriptionStatus && subscriptionStatus !== existing.subscriptionStatus) {
      before.subscriptionStatus = existing.subscriptionStatus;
      data.subscriptionStatus = subscriptionStatus;
    }
  }

  if ("planId" in body) {
    const plan = body.planId
      ? await prisma.plan.findFirst({ where: { id: String(body.planId), active: true } })
      : null;
    if (body.planId && !plan) throw Object.assign(new Error("Plan not found"), { code: "NOT_FOUND" });
    if (plan?.id !== existing.planId) {
      before.planId = existing.planId;
      if (plan) data.plan = { connect: { id: plan.id } };
      else data.plan = { disconnect: true };
    }
  }

  if (body.trialEnd !== undefined) {
    const next = String(body.trialEnd ?? "").trim() ? asDate(body.trialEnd) ?? null : null;
    if (next?.getTime() !== existing.trialEnd?.getTime() || Boolean(next) !== Boolean(existing.trialEnd)) {
      before.trialEnd = existing.trialEnd;
      data.trialEnd = next;
    }
  }

  if (body.discountType !== undefined || body.discountValue !== undefined || body.discountReason !== undefined) {
    const current = {
      discountType: (existing as { discountType?: string }).discountType ?? "NONE",
      discountValue: Number((existing as { discountValue?: unknown }).discountValue ?? 0),
      discountReason: (existing as { discountReason?: string | null }).discountReason ?? null,
    };
    const next = normalizeTenantDiscount({
      discountType: body.discountType ?? current.discountType,
      discountValue: body.discountValue ?? current.discountValue,
      discountReason: body.discountReason ?? current.discountReason ?? undefined,
    });
    if (next.type !== current.discountType || next.value !== current.discountValue || next.reason !== current.discountReason) {
      before.discountType = current.discountType;
      before.discountValue = String(current.discountValue);
      before.discountReason = current.discountReason;
      data.discountType = next.type;
      data.discountValue = next.value.toFixed(4);
      data.discountReason = next.reason;
    }
  }

  if (!Object.keys(data).length) return serializeTenantRow(existing);

  const row = await prisma.tenant.update({ where: { id }, data, include: { plan: true } });
  await writeAudit({
    ctx,
    action: "platform.tenant.update",
    entityType: "Tenant",
    entityId: id,
    before,
    after: Object.fromEntries(Object.keys(before).map((k) => [k, row[k as keyof typeof row]])),
  });
  return serializeTenantRow(row);
}

export async function createInvoice(ctx: RequestContext, body: Record<string, unknown>) {
  const tenantId = String(body.tenantId ?? "").trim();
  if (!tenantId) throw Object.assign(new Error("tenantId required"), { code: "VALIDATION" });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  if (!tenant) throw Object.assign(new Error("Tenant not found"), { code: "NOT_FOUND" });
  const defaults = previousMonthRange();
  const periodStart = asDate(body.periodStart, defaults.periodStart)!;
  const periodEnd = asDate(body.periodEnd, defaults.periodEnd)!;
  const dueDate = asDate(body.dueDate, defaults.dueDate)!;
  const planPrice = Number((tenant.plan as { price?: unknown } | null)?.price ?? 0);
  const hasExplicitAmount = body.amount !== undefined && body.amount !== null && String(body.amount).trim() !== "";
  const subtotalRaw = hasExplicitAmount ? Number(body.amount) : Number.isFinite(planPrice) ? planPrice : 0;
  if (!Number.isFinite(subtotalRaw) || subtotalRaw < 0) throw Object.assign(new Error("amount invalid"), { code: "VALIDATION" });
  const subtotal = Math.round(subtotalRaw * 100) / 100;
  const tenantDiscountType = parseDiscountType((tenant as { discountType?: unknown }).discountType);
  const tenantDiscountValue = parseDiscountValue((tenant as { discountValue?: unknown }).discountValue);
  const discountType =
    body.discountType !== undefined ? parseDiscountType(body.discountType) : tenantDiscountType;
  const discountValueRaw =
    body.discountValue ?? body.discountPercent ?? body.discountAmount ?? tenantDiscountValue;
  let discountValue = parseDiscountValue(discountValueRaw);
  if (discountType === "PERCENT") discountValue = Math.min(100, discountValue);
  if (discountType === "NONE") discountValue = 0;
  const discountAmount = Math.round(calcDiscountAmount(subtotal, discountType, discountValue) * 100) / 100;
  const amount = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
  const number = await nextPlatformInvoiceNumber();
  const row = await prisma.platformInvoice.create({
    data: {
      number,
      tenantId,
      periodStart,
      periodEnd,
      dueDate,
      subtotal: subtotal.toFixed(4),
      discountType,
      discountValue: discountValue.toFixed(4),
      discountAmount: discountAmount.toFixed(4),
      amount: amount.toFixed(4),
      currency: String(body.currency ?? tenant.plan?.currency ?? "BDT"),
      notes: body.notes != null ? String(body.notes) : null,
      lines: Array.isArray(body.lines) ? (body.lines as Prisma.InputJsonValue) : undefined,
      createdById: ctx.userId,
      status: dueDate.getTime() < Date.now() ? "OVERDUE" : "PENDING",
    },
    include: invoiceInclude,
  });
  await recordEvent({ invoiceId: row.id, tenantId, type: "CREATED", actorId: ctx.userId });
  await writeAudit({
    ctx,
    tenantId,
    action: "platform.invoice.create",
    entityType: "PlatformInvoice",
    entityId: row.id,
    after: { number, subtotal, discountType, discountValue, discountAmount, amount, tenantId },
  });
  return serializeInvoice(row);
}

function invoiceWhere(query: Record<string, unknown>, tenantId?: string): Prisma.PlatformInvoiceWhereInput {
  const status = typeof query.status === "string" ? query.status.toUpperCase() : "";
  const unpaid = query.unpaid === "true" || query.unpaid === true;
  const overdue = query.overdue === "true" || query.overdue === true;
  const tid = tenantId || (typeof query.tenantId === "string" ? query.tenantId : "");
  const list = parseListQuery(query, { sortable: ["createdAt", "dueDate", "amount"], defaultSort: "createdAt" });
  const dates = createdAtRange(list);
  const where: Prisma.PlatformInvoiceWhereInput = {
    ...(tid ? { tenantId: tid } : {}),
    ...(status && ["PENDING", "PAID", "OVERDUE", "VOID"].includes(status) ? { status: status as PlatformInvoiceStatus } : {}),
    ...(unpaid ? { status: { in: ["PENDING", "OVERDUE"] } } : {}),
    ...(overdue ? { status: "OVERDUE" } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(list.search
      ? {
          OR: [
            { number: { contains: list.search, mode: "insensitive" } },
            { tenant: { name: { contains: list.search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  return where;
}

export async function listInvoices(query: Record<string, unknown>, tenantId?: string) {
  await syncOverdueInvoices(tenantId);
  const list = parseListQuery(query, { sortable: ["createdAt", "dueDate", "amount", "number"], defaultSort: "createdAt" });
  const where = invoiceWhere(query, tenantId);
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.platformInvoice.findMany({
        where,
        orderBy: { [list.sortBy]: list.sortOrder } as Prisma.PlatformInvoiceOrderByWithRelationInput,
        skip,
        take,
        include: { tenant: { select: { id: true, name: true, apiAccessEnabled: true } } },
      }),
    count: () => prisma.platformInvoice.count({ where }),
  });
  return { rows: rows.map(serializeInvoice), pagination };
}

export async function getInvoice(id: string) {
  await syncOverdueInvoices();
  return prisma.platformInvoice.findUnique({ where: { id }, include: invoiceInclude });
}

export async function sendInvoice(ctx: RequestContext, id: string) {
  const existing = await prisma.platformInvoice.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Invoice not found"), { code: "NOT_FOUND" });
  if (existing.status === "VOID") throw Object.assign(new Error("Cannot send a void invoice"), { code: "VALIDATION" });
  const row = await prisma.platformInvoice.update({
    where: { id },
    data: { sentAt: existing.sentAt ?? new Date() },
    include: invoiceInclude,
  });
  await recordEvent({ invoiceId: id, tenantId: row.tenantId, type: "SENT", actorId: ctx.userId });
  await enqueueOutbox(prisma, {
    tenantId: row.tenantId,
    type: "PLATFORM_INVOICE_SENT",
    aggregateId: row.id,
    payload: {
      invoiceId: row.id,
      number: row.number,
      amount: String(row.amount),
      currency: row.currency,
      entityType: "PlatformInvoice",
      entityId: row.id,
      message: `Invoice ${row.number} for ${row.currency} ${Number(row.amount).toFixed(2)} is ready.`,
    },
  });
  await writeAudit({
    ctx,
    tenantId: row.tenantId,
    action: "platform.invoice.send",
    entityType: "PlatformInvoice",
    entityId: row.id,
    after: { number: row.number, sentAt: row.sentAt },
  });
  await processOutboxBatch(20);
  return serializeInvoice(row);
}

export async function updateInvoice(ctx: RequestContext, id: string, body: Record<string, unknown>) {
  const existing = await prisma.platformInvoice.findUnique({
    where: { id },
    include: { tenant: { include: { plan: true } } },
  });
  if (!existing) throw Object.assign(new Error("Invoice not found"), { code: "NOT_FOUND" });
  if (existing.status === "PAID") throw Object.assign(new Error("Paid invoices can't be edited"), { code: "VALIDATION" });
  if (existing.status === "VOID") throw Object.assign(new Error("Void invoices can't be edited"), { code: "VALIDATION" });

  const data: Prisma.PlatformInvoiceUpdateInput = {};
  const before: Record<string, unknown> = {};

  const touchesMoney =
    body.amount !== undefined || body.discountType !== undefined || body.discountValue !== undefined;
  if (touchesMoney) {
    const currentSubtotal = Number(existing.subtotal ?? existing.amount) || 0;
    const subtotalRaw =
      body.amount !== undefined && body.amount !== null && String(body.amount).trim() !== ""
        ? Number(body.amount)
        : currentSubtotal;
    if (!Number.isFinite(subtotalRaw) || subtotalRaw < 0) {
      throw Object.assign(new Error("amount invalid"), { code: "VALIDATION" });
    }
    const subtotal = Math.round(subtotalRaw * 100) / 100;
    const currentType = parseDiscountType((existing as { discountType?: unknown }).discountType);
    const currentValue = parseDiscountValue((existing as { discountValue?: unknown }).discountValue);
    const discountType = body.discountType !== undefined ? parseDiscountType(body.discountType) : currentType;
    let discountValue =
      body.discountValue !== undefined ? parseDiscountValue(body.discountValue) : currentValue;
    if (discountType === "PERCENT") discountValue = Math.min(100, discountValue);
    if (discountType === "NONE") discountValue = 0;
    const discountAmount = Math.round(calcDiscountAmount(subtotal, discountType, discountValue) * 100) / 100;
    const amount = Math.max(0, Math.round((subtotal - discountAmount) * 100) / 100);
    before.subtotal = String(existing.subtotal ?? existing.amount);
    before.discountType = (existing as { discountType?: unknown }).discountType ?? "NONE";
    before.discountValue = String((existing as { discountValue?: unknown }).discountValue ?? 0);
    before.amount = String(existing.amount);
    data.subtotal = subtotal.toFixed(4);
    data.discountType = discountType;
    data.discountValue = discountValue.toFixed(4);
    data.discountAmount = discountAmount.toFixed(4);
    data.amount = amount.toFixed(4);
  }

  if (body.currency !== undefined) {
    const currency = String(body.currency ?? "").trim().toUpperCase().slice(0, 8) || existing.currency;
    if (currency !== existing.currency) {
      before.currency = existing.currency;
      data.currency = currency;
    }
  }

  let dueDateChanged = false;
  if (body.periodStart !== undefined) {
    const next = asDate(body.periodStart);
    if (next && next.getTime() !== existing.periodStart.getTime()) {
      before.periodStart = existing.periodStart;
      data.periodStart = next;
    }
  }
  if (body.periodEnd !== undefined) {
    const next = asDate(body.periodEnd);
    if (next && next.getTime() !== existing.periodEnd.getTime()) {
      before.periodEnd = existing.periodEnd;
      data.periodEnd = next;
    }
  }
  if (body.dueDate !== undefined) {
    const next = asDate(body.dueDate);
    if (next && next.getTime() !== existing.dueDate.getTime()) {
      before.dueDate = existing.dueDate;
      data.dueDate = next;
      dueDateChanged = true;
    }
  }
  if (body.notes !== undefined) {
    const notes = body.notes != null && String(body.notes).trim() ? String(body.notes) : null;
    if (notes !== existing.notes) {
      before.notes = existing.notes;
      data.notes = notes;
    }
  }

  // Keep PENDING/OVERDUE in sync when the due date moves.
  if (dueDateChanged && data.dueDate instanceof Date) {
    const nextStatus = data.dueDate.getTime() < Date.now() ? "OVERDUE" : "PENDING";
    if (nextStatus !== existing.status) {
      before.status = existing.status;
      data.status = nextStatus;
    }
  }

  if (!Object.keys(data).length) return serializeInvoice(existing);
  const row = await prisma.platformInvoice.update({ where: { id }, data, include: invoiceInclude });
  await recordEvent({ invoiceId: id, tenantId: row.tenantId, type: "UPDATED", actorId: ctx.userId });
  await writeAudit({
    ctx,
    tenantId: row.tenantId,
    action: "platform.invoice.update",
    entityType: "PlatformInvoice",
    entityId: id,
    before,
    after: Object.fromEntries(Object.keys(before).map((k) => [k, (row as Record<string, unknown>)[k]])),
  });
  return serializeInvoice(row);
}

export async function setInvoiceStatus(ctx: RequestContext, id: string, body: Record<string, unknown>) {
  const status = String(body.status ?? "").toUpperCase() as PlatformInvoiceStatus;
  if (!["PAID", "OVERDUE", "VOID", "PENDING"].includes(status)) {
    throw Object.assign(new Error("status must be PAID, OVERDUE, VOID, or PENDING"), { code: "VALIDATION" });
  }
  const existing = await prisma.platformInvoice.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Invoice not found"), { code: "NOT_FOUND" });
  const paidNote = body.paidNote != null ? String(body.paidNote) : existing.paidNote;
  const row = await prisma.platformInvoice.update({
    where: { id },
    data: {
      status,
      paidAt: status === "PAID" ? new Date() : status === "PENDING" || status === "OVERDUE" ? null : existing.paidAt,
      paidNote: status === "PAID" ? paidNote : existing.paidNote,
    },
    include: invoiceInclude,
  });
  await recordEvent({
    invoiceId: id,
    tenantId: row.tenantId,
    type: "STATUS",
    note: `${existing.status} → ${status}${paidNote ? `: ${paidNote}` : ""}`,
    actorId: ctx.userId,
  });
  await writeAudit({
    ctx,
    tenantId: row.tenantId,
    action: "platform.invoice.status",
    entityType: "PlatformInvoice",
    entityId: row.id,
    before: { status: existing.status },
    after: { status, paidNote },
  });
  return serializeInvoice(row);
}

export async function sendReceipt(ctx: RequestContext, id: string) {
  const existing = await prisma.platformInvoice.findUnique({ where: { id } });
  if (!existing) throw Object.assign(new Error("Invoice not found"), { code: "NOT_FOUND" });
  if (existing.status !== "PAID") throw Object.assign(new Error("Receipt can only be sent for a paid invoice"), { code: "VALIDATION" });
  await recordEvent({ invoiceId: id, tenantId: existing.tenantId, type: "RECEIPT_SENT", actorId: ctx.userId });
  await enqueueOutbox(prisma, {
    tenantId: existing.tenantId,
    type: "PLATFORM_RECEIPT_SENT",
    aggregateId: existing.id,
    payload: {
      invoiceId: existing.id,
      number: existing.number,
      amount: String(existing.amount),
      currency: existing.currency,
      entityType: "PlatformInvoice",
      entityId: existing.id,
      message: `Payment confirmed for invoice ${existing.number}.`,
    },
  });
  await writeAudit({
    ctx,
    tenantId: existing.tenantId,
    action: "platform.invoice.receipt",
    entityType: "PlatformInvoice",
    entityId: existing.id,
    after: { number: existing.number },
  });
  await processOutboxBatch(20);
  return serializeInvoice(await prisma.platformInvoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude }));
}

export async function setTenantApiAccess(ctx: RequestContext, tenantId: string, enabled: boolean, reason?: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw Object.assign(new Error("Tenant not found"), { code: "NOT_FOUND" });
  const now = new Date();
  const inTrial = tenant.trialEnd && tenant.trialEnd.getTime() > now.getTime();
  const row = await prisma.tenant.update({
    where: { id: tenantId },
    data: enabled
      ? {
          apiAccessEnabled: true,
          apiAccessDisabledAt: null,
          apiAccessDisabledReason: null,
          subscriptionStatus: inTrial ? "TRIAL" : "ACTIVE",
        }
      : {
          apiAccessEnabled: false,
          apiAccessDisabledAt: now,
          apiAccessDisabledReason: reason?.trim() || PAYMENT_REQUIRED_MESSAGE,
          subscriptionStatus: "SUSPENDED",
        },
    include: { plan: true },
  });
  await recordEvent({
    tenantId,
    type: enabled ? "API_ENABLED" : "API_DISABLED",
    note: reason?.trim() || (enabled ? "API access restored" : PAYMENT_REQUIRED_MESSAGE),
    actorId: ctx.userId,
  });
  await writeAudit({
    ctx,
    tenantId,
    action: enabled ? "platform.tenant.api.enable" : "platform.tenant.api.disable",
    entityType: "Tenant",
    entityId: tenantId,
    before: { apiAccessEnabled: tenant.apiAccessEnabled },
    after: { apiAccessEnabled: enabled, reason },
  });
  return row;
}

export async function assertTenantApiKeysAllowed(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { apiAccessEnabled: true },
  });
  if (tenant && tenant.apiAccessEnabled === false) {
    throw Object.assign(new Error(PAYMENT_REQUIRED_MESSAGE), { code: "PAYMENT_REQUIRED" });
  }
}
