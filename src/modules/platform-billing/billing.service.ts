import type { PlatformInvoice, PlatformInvoiceStatus, Prisma } from "@prisma/client";
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
  };
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

export async function createInvoice(ctx: RequestContext, body: Record<string, unknown>) {
  const tenantId = String(body.tenantId ?? "").trim();
  if (!tenantId) throw Object.assign(new Error("tenantId required"), { code: "VALIDATION" });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  if (!tenant) throw Object.assign(new Error("Tenant not found"), { code: "NOT_FOUND" });
  const defaults = previousMonthRange();
  const periodStart = asDate(body.periodStart, defaults.periodStart)!;
  const periodEnd = asDate(body.periodEnd, defaults.periodEnd)!;
  const dueDate = asDate(body.dueDate, defaults.dueDate)!;
  const amountRaw = body.amount ?? tenant.plan?.price ?? 0;
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount < 0) throw Object.assign(new Error("amount invalid"), { code: "VALIDATION" });
  const number = await nextPlatformInvoiceNumber();
  const row = await prisma.platformInvoice.create({
    data: {
      number,
      tenantId,
      periodStart,
      periodEnd,
      dueDate,
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
    after: { number, amount, tenantId },
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
