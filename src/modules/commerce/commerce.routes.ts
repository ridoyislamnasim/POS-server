import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { branchScope, nextDocNumber, num, tenantId } from "../../lib/erp.js";
import { assertBranch } from "../../lib/scope.js";
import type { AuthedRequest } from "../../types.js";
import { acceptEnum, acceptId, createdAtRange, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";

export const commerceRouter = Router();
commerceRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

commerceRouter.get("/sales-orders", requirePermission("order.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "number", "total", "status"], defaultSort: "createdAt", defaultOrder: "desc" });
  const status = acceptEnum(req.query.status, ["DRAFT", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "CONVERTED"] as const);
  const customerId = acceptId(req.query.customerId);
  const dates = createdAtRange(list);
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    ...branchScope(ctx),
    ...(status ? { status } : {}),
    ...(customerId ? { customerId } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(q ? { OR: [{ number: ilike(q) }, { notes: ilike(q) }, { customer: { name: ilike(q) } }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.salesOrder.findMany({
        where,
        select: {
          id: true,
          number: true,
          total: true,
          status: true,
          createdAt: true,
          customer: { select: { id: true, name: true } },
          branch: { select: { name: true } },
        },
        orderBy: list.sortBy === "number" || list.sortBy === "total" || list.sortBy === "status" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.salesOrder.count({ where }),
  });
  return okList(res, rows, pagination);
});

commerceRouter.post("/sales-orders", requirePermission("order.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { branchId, customerId, notes, items } = req.body ?? {};
  if (!branchId || !Array.isArray(items) || !items.length) return fail(res, "VALIDATION", "branchId and items required");
  assertBranch(ctx, branchId);
  const tid = tenantId(ctx);
  const computed = [];
  for (const i of items as { variantId: string; qty: number; unitPrice?: number }[]) {
    const v = await prisma.productVariant.findFirst({
      where: { id: i.variantId, tenantId: tid },
      include: { product: true },
    });
    if (!v) return fail(res, "NOT_FOUND", "Variant not found", 404);
    const qty = num(i.qty);
    const price = num(i.unitPrice ?? v.price);
    computed.push({
      variantId: v.id,
      qty,
      unitPrice: price,
      lineTotal: qty * price,
      nameSnapshot: v.product.name,
      skuSnapshot: v.sku,
    });
  }
  const subtotal = computed.reduce((n, i) => n + i.lineTotal, 0);
  const number = await nextDocNumber(tid, branchId, "SO", "SO");
  const row = await prisma.salesOrder.create({
    data: {
      tenantId: tid,
      branchId,
      customerId: customerId || null,
      notes,
      number,
      status: "CONFIRMED",
      subtotal: String(subtotal),
      tax: "0",
      total: String(subtotal),
      createdById: ctx.userId,
      items: { create: computed.map((i) => ({ ...i, qty: String(i.qty), unitPrice: String(i.unitPrice), lineTotal: String(i.lineTotal) })) },
    },
    include: { items: true, customer: true },
  });
  return ok(res, row, undefined, 201);
});

commerceRouter.patch("/sales-orders/:id", requirePermission("order.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.salesOrder.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Sales order not found", 404);
  const status = req.body?.status as string | undefined;
  if (status && !["DRAFT", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"].includes(status)) {
    return fail(res, "VALIDATION", "Invalid status");
  }
  if (status === "CANCELLED" && existing.status === "CONVERTED") {
    return fail(res, "CONFLICT", "Converted orders cannot be cancelled", 409);
  }
  const row = await prisma.salesOrder.update({
    where: { id: existing.id },
    data: { status: status as never, notes: req.body?.notes },
    include: { items: true, customer: true },
  });
  return ok(res, row);
});

commerceRouter.get("/ecommerce", requirePermission("order.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "total", "status"], defaultSort: "createdAt", defaultOrder: "desc" });
  const status = acceptEnum(req.query.status, ["DRAFT", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "CONVERTED"] as const);
  const q = list.search;
  const dates = createdAtRange(list);
  const where = {
    tenantId: tenantId(ctx),
    ...(status ? { status } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(q
      ? {
          OR: [{ channel: ilike(q) }, { externalId: ilike(q) }, { customer: { name: ilike(q) } }],
        }
      : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.ecommerceOrder.findMany({
        where,
        select: {
          id: true,
          channel: true,
          externalId: true,
          status: true,
          total: true,
          createdAt: true,
          customer: { select: { id: true, name: true } },
        },
        orderBy: list.sortBy === "total" || list.sortBy === "status" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.ecommerceOrder.count({ where }),
  });
  return okList(res, rows, pagination);
});

commerceRouter.post("/ecommerce", requirePermission("order.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { channel, externalId, customerId, total, payload, status } = req.body ?? {};
  if (!channel || !externalId || total == null) return fail(res, "VALIDATION", "channel, externalId, total required");
  const row = await prisma.ecommerceOrder.upsert({
    where: { tenantId_channel_externalId: { tenantId: tenantId(ctx), channel, externalId: String(externalId) } },
    create: {
      tenantId: tenantId(ctx),
      channel,
      externalId: String(externalId),
      customerId: customerId || null,
      total: String(total),
      payload: payload ?? {},
      status: status ?? "CONFIRMED",
    },
    update: { payload: payload ?? {}, total: String(total), status: status ?? undefined },
    include: { customer: true },
  });
  return ok(res, row, undefined, 201);
});

commerceRouter.get("/deliveries", requirePermission("delivery.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "status"], defaultSort: "createdAt", defaultOrder: "desc" });
  const status = acceptEnum(req.query.status, ["PENDING", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "FAILED", "RETURNED"] as const);
  const q = list.search;
  const dates = createdAtRange(list);
  const where = {
    tenantId: tenantId(ctx),
    ...branchScope(ctx),
    ...(status ? { status } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(q ? { OR: [{ address: ilike(q) }, { phone: { contains: q } }, { tracking: ilike(q) }, { courier: ilike(q) }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.delivery.findMany({
        where,
        select: {
          id: true,
          status: true,
          address: true,
          phone: true,
          courier: true,
          tracking: true,
          createdAt: true,
          branch: { select: { name: true } },
          salesOrder: { select: { number: true } },
        },
        orderBy: list.sortBy === "status" ? { status: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.delivery.count({ where }),
  });
  return okList(res, rows, pagination);
});

commerceRouter.post("/deliveries", requirePermission("delivery.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { branchId, salesOrderId, saleId, address, phone, courier, tracking, scheduledAt, notes } = req.body ?? {};
  if (!branchId || !address) return fail(res, "VALIDATION", "branchId and address required");
  assertBranch(ctx, branchId);
  const row = await prisma.delivery.create({
    data: {
      tenantId: tenantId(ctx),
      branchId,
      salesOrderId: salesOrderId || null,
      saleId: saleId || null,
      address,
      phone,
      courier,
      tracking,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      notes,
    },
  });
  return ok(res, row, undefined, 201);
});

commerceRouter.patch("/deliveries/:id", requirePermission("delivery.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.delivery.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Delivery not found", 404);
  const row = await prisma.delivery.update({
    where: { id: existing.id },
    data: {
      status: req.body?.status,
      courier: req.body?.courier,
      tracking: req.body?.tracking,
      address: req.body?.address,
      phone: req.body?.phone,
      deliveredAt: req.body?.status === "DELIVERED" ? new Date() : undefined,
      notes: req.body?.notes,
    },
  });
  return ok(res, row);
});

commerceRouter.delete("/deliveries/:id", requirePermission("delivery.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.delivery.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Delivery not found", 404);
  await prisma.delivery.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});

commerceRouter.delete("/ecommerce/:id", requirePermission("order.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.ecommerceOrder.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Order not found", 404);
  await prisma.ecommerceOrder.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});
