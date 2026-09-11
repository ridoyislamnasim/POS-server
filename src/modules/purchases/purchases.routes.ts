import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { branchScope, nextDocNumber, num, tenantId } from "../../lib/erp.js";
import { assertBranch } from "../../lib/scope.js";
import { applyStockChange } from "../inventory/stock.engine.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { linkPurchaseReceipt } from "../inventory/receipts.service.js";
import type { AuthedRequest } from "../../types.js";
import { acceptEnum, acceptId, createdAtRange, ilike, parseListQuery, scopedBranchId, withPagination } from "../../lib/list-query.js";

export const purchasesRouter = Router();
purchasesRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

purchasesRouter.get("/", requirePermission("purchase.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "invoiceNumber", "total", "status"], defaultSort: "createdAt", defaultOrder: "desc" });
  const status = acceptEnum(req.query.status, ["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"] as const);
  const supplierId = acceptId(req.query.supplierId);
  const branchId = scopedBranchId(ctx, req.query.branchId);
  const dates = createdAtRange(list);
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    ...branchScope(ctx),
    ...(branchId ? { branchId } : {}),
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(q
      ? {
          OR: [{ invoiceNumber: ilike(q) }, { notes: ilike(q) }, { supplier: { name: ilike(q) } }],
        }
      : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.purchase.findMany({
        where,
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          paid: true,
          due: true,
          status: true,
          createdAt: true,
          supplier: { select: { id: true, name: true, phone: true } },
          branch: { select: { name: true } },
          items: { select: { id: true, variantId: true, qty: true, unitCost: true } },
        },
        orderBy: list.sortBy === "invoiceNumber" || list.sortBy === "total" || list.sortBy === "status" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.purchase.count({ where }),
  });
  return okList(res, rows, pagination);
});

purchasesRouter.get("/orders", requirePermission("purchase.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "number", "total", "status"], defaultSort: "createdAt", defaultOrder: "desc" });
  const status = acceptEnum(req.query.status, ["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"] as const);
  const supplierId = acceptId(req.query.supplierId);
  const dates = createdAtRange(list);
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    ...branchScope(ctx),
    ...(status ? { status } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(q ? { OR: [{ number: ilike(q) }, { notes: ilike(q) }, { supplier: { name: ilike(q) } }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.purchaseOrder.findMany({
        where,
        select: {
          id: true,
          number: true,
          total: true,
          status: true,
          createdAt: true,
          supplier: { select: { id: true, name: true } },
          branch: { select: { name: true } },
        },
        orderBy: list.sortBy === "number" || list.sortBy === "total" || list.sortBy === "status" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.purchaseOrder.count({ where }),
  });
  return okList(res, rows, pagination);
});

purchasesRouter.get("/orders/:id", requirePermission("purchase.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const row = await prisma.purchaseOrder.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
    include: { supplier: true, branch: { select: { name: true } }, items: true, purchases: true },
  });
  if (!row) return fail(res, "NOT_FOUND", "Purchase order not found", 404);
  return ok(res, row);
});

purchasesRouter.post("/orders", requirePermission("purchase.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { branchId, supplierId, notes, expectedAt, items } = req.body ?? {};
  if (!branchId || !supplierId || !Array.isArray(items) || !items.length) {
    return fail(res, "VALIDATION", "branchId, supplierId, items required");
  }
  assertBranch(ctx, branchId);
  const tid = tenantId(ctx);
  const computed = items.map((i: { variantId: string; qty: number; unitCost: number; taxRate?: number }) => {
    const qty = num(i.qty);
    const cost = num(i.unitCost);
    const taxRate = num(i.taxRate);
    const line = qty * cost;
    const tax = line * (taxRate / 100);
    return { variantId: i.variantId, qty, unitCost: cost, taxRate, lineTotal: line + tax };
  });
  const subtotal = computed.reduce((n, i) => n + i.qty * i.unitCost, 0);
  const tax = computed.reduce((n, i) => n + i.qty * i.unitCost * (i.taxRate / 100), 0);
  const number = await nextDocNumber(tid, branchId, "PO", "PO");
  const row = await prisma.purchaseOrder.create({
    data: {
      tenantId: tid,
      branchId,
      supplierId,
      notes,
      expectedAt: expectedAt ? new Date(expectedAt) : null,
      number,
      status: "ORDERED",
      subtotal: String(subtotal),
      tax: String(tax),
      total: String(subtotal + tax),
      createdById: ctx.userId,
      items: {
        create: computed.map((i) => ({
          variantId: i.variantId,
          qty: String(i.qty),
          unitCost: String(i.unitCost),
          taxRate: String(i.taxRate),
          lineTotal: String(i.lineTotal),
        })),
      },
    },
    include: { items: true, supplier: true },
  });
  await enqueueOutbox(prisma, {
    tenantId: tid,
    type: "PURCHASE_CREATED",
    aggregateId: row.id,
    payload: { branchId, number: row.number, entityType: "PurchaseOrder", entityId: row.id },
  });
  return ok(res, row, undefined, 201);
});

purchasesRouter.post("/orders/:id/cancel", requirePermission("purchase.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.purchaseOrder.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
    include: { purchases: true },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Purchase order not found", 404);
  if (existing.purchases.length) return fail(res, "CONFLICT", "This PO already has receipts", 409);
  if (existing.status === "CANCELLED") return fail(res, "CONFLICT", "Already cancelled", 409);
  const row = await prisma.purchaseOrder.update({
    where: { id: existing.id },
    data: { status: "CANCELLED" },
    include: { supplier: true, items: true },
  });
  await writeAudit({ ctx, action: "purchase.order.cancel", entityType: "PurchaseOrder", entityId: row.id });
  await enqueueOutbox(prisma, {
    tenantId: tenantId(ctx),
    type: "PURCHASE_CANCELLED",
    aggregateId: row.id,
    payload: { branchId: row.branchId, number: row.number, entityType: "PurchaseOrder", entityId: row.id },
  });
  return ok(res, row);
});

purchasesRouter.post("/", requirePermission("purchase.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { branchId, locationId, supplierId, purchaseOrderId, paid, notes, items } = req.body ?? {};
  if (!branchId || !supplierId || !Array.isArray(items) || !items.length) {
    return fail(res, "VALIDATION", "branchId, supplierId, items required");
  }
  assertBranch(ctx, branchId);
  const tid = tenantId(ctx);
  const branch = await prisma.branch.findFirst({ where: { id: branchId, tenantId: tid } });
  if (!branch) return fail(res, "NOT_FOUND", "Branch not found", 404);
  const loc = locationId || branch.locationId;
  const itemRows = items as { variantId: string; qty: number; unitCost: number; taxRate?: number }[];
  const ids = [...new Set(itemRows.map((i) => i.variantId).filter(Boolean))];
  const owned = await prisma.productVariant.findMany({
    where: { tenantId: tid, id: { in: ids } },
    select: { id: true },
  });
  if (owned.length !== ids.length) return fail(res, "FORBIDDEN", "Variant not in tenant", 403);
  const computed = itemRows.map((i) => {
    const qty = new Prisma.Decimal(String(i.qty ?? 0));
    const cost = new Prisma.Decimal(String(i.unitCost ?? 0));
    const taxRate = new Prisma.Decimal(String(i.taxRate ?? 0));
    const line = qty.mul(cost);
    const taxAmount = line.mul(taxRate).div(100);
    return { variantId: i.variantId, qty, unitCost: cost, taxRate, taxAmount, lineTotal: line.plus(taxAmount) };
  });
  const subtotal = computed.reduce((n, i) => n.plus(i.qty.mul(i.unitCost)), new Prisma.Decimal(0));
  const tax = computed.reduce((n, i) => n.plus(i.taxAmount), new Prisma.Decimal(0));
  const total = subtotal.plus(tax);
  const paidAmt = new Prisma.Decimal(String(paid ?? 0));
  const due = Prisma.Decimal.max(total.minus(paidAmt), 0);
  const invoiceNumber = await nextDocNumber(tid, branchId, "GRN", "GRN");

  const row = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        tenantId: tid,
        branchId,
        locationId: loc,
        supplierId,
        purchaseOrderId: purchaseOrderId || null,
        invoiceNumber,
        businessDate: new Date(ctx.businessDate),
        subtotal: String(subtotal),
        tax: String(tax),
        total: String(total),
        paid: String(paidAmt),
        due: String(due),
        notes,
        status: "RECEIVED",
        createdById: ctx.userId,
        items: {
          create: computed.map((i) => ({
            variantId: i.variantId,
            qty: String(i.qty),
            unitCost: String(i.unitCost),
            taxRate: String(i.taxRate),
            taxAmount: String(i.taxAmount),
            lineTotal: String(i.lineTotal),
          })),
        },
      },
      include: { items: true, supplier: true },
    });
    for (const i of computed) {
      await applyStockChange(tx, {
        tenantId: tid,
        locationId: loc,
        variantId: i.variantId,
        bucket: "AVAILABLE",
        delta: i.qty,
        type: "PURCHASE",
        referenceType: "Purchase",
        referenceId: purchase.id,
        createdById: ctx.userId,
        unitCost: i.unitCost,
      });
    }
    await linkPurchaseReceipt(tx, {
      tenantId: tid,
      branchId,
      locationId: loc,
      purchaseId: purchase.id,
      supplierId,
      userId: ctx.userId,
      items: computed.map((i) => ({ variantId: i.variantId, qty: i.qty, unitCost: i.unitCost })),
      notes,
    });
    if (due.greaterThan(0)) {
      await tx.supplier.update({
        where: { id: supplierId },
        data: { creditDue: { increment: due } },
      });
    }
    if (purchaseOrderId) {
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: { status: "RECEIVED" },
      });
    }
    await enqueueOutbox(tx, {
      tenantId: tid,
      type: "PURCHASE_RECEIVED",
      aggregateId: purchase.id,
      payload: { branchId, number: purchase.invoiceNumber, entityType: "Purchase", entityId: purchase.id },
    });
    return purchase;
  });
  await writeAudit({ ctx, action: "purchase.create", entityType: "Purchase", entityId: row.id });
  return ok(res, row, undefined, 201);
});

purchasesRouter.get("/returns", requirePermission("purchase.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "number"], defaultSort: "createdAt", defaultOrder: "desc" });
  const q = list.search;
  const dates = createdAtRange(list);
  const where = {
    tenantId: tenantId(ctx),
    ...branchScope(ctx),
    ...(dates ? { createdAt: dates } : {}),
    ...(q ? { OR: [{ number: ilike(q) }, { reason: ilike(q) }, { purchase: { invoiceNumber: ilike(q) } }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.purchaseReturn.findMany({
        where,
        select: {
          id: true,
          number: true,
          reason: true,
          total: true,
          createdAt: true,
          purchase: { select: { invoiceNumber: true, supplier: { select: { id: true, name: true, phone: true } } } },
        },
        orderBy: { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.purchaseReturn.count({ where }),
  });
  return okList(res, rows, pagination);
});

purchasesRouter.get("/:id", requirePermission("purchase.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const row = await prisma.purchase.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
    include: { supplier: true, branch: { select: { name: true } }, items: true, returns: { include: { items: true } } },
  });
  if (!row) return fail(res, "NOT_FOUND", "Purchase not found", 404);
  return ok(res, row);
});

purchasesRouter.post("/:id/returns", requirePermission("purchase.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const reason = String(req.body?.reason ?? "").trim();
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!reason || !items.length) return fail(res, "VALIDATION", "reason and items required");
  const tid = tenantId(ctx);
  try {
    const row = await prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.findFirst({
        where: { id: String(req.params.id), tenantId: tid },
        include: { items: true, returns: { include: { items: true } } },
      });
      if (!purchase) throw Object.assign(new Error("Purchase not found"), { code: "NOT_FOUND" });
      assertBranch(ctx, purchase.branchId);
      const used = new Map<string, number>();
      for (const r of purchase.returns) {
        for (const li of r.items) {
          used.set(li.purchaseItemId, (used.get(li.purchaseItemId) ?? 0) + num(li.qty));
        }
      }
      const computed: { purchaseItemId: string; variantId: string; qty: number; unitCost: number; lineTotal: number }[] = items.map(
        (i: { purchaseItemId: string; qty: number }) => {
        const item = purchase.items.find((p) => p.id === i.purchaseItemId);
        if (!item) throw Object.assign(new Error("Purchase item not found"), { code: "VALIDATION" });
        const qty = num(i.qty);
        const remaining = num(item.qty) - (used.get(item.id) ?? 0);
        if (qty <= 0 || qty > remaining) throw Object.assign(new Error(`Invalid qty for ${item.variantId}`), { code: "VALIDATION" });
        return {
          purchaseItemId: item.id,
          variantId: item.variantId,
          qty,
          unitCost: num(item.unitCost),
          lineTotal: qty * num(item.unitCost),
        };
      });
      const total = computed.reduce((n, i) => n + i.lineTotal, 0);
      const number = await nextDocNumber(tid, purchase.branchId, "PRN", "PRN");
      const ret = await tx.purchaseReturn.create({
        data: {
          tenantId: tid,
          branchId: purchase.branchId,
          purchaseId: purchase.id,
          number,
          reason,
          notes: req.body?.notes ?? null,
          total: String(total),
          createdById: ctx.userId,
          items: {
            create: computed.map((i) => ({
              purchaseItemId: i.purchaseItemId,
              variantId: i.variantId,
              qty: String(i.qty),
              unitCost: String(i.unitCost),
              lineTotal: String(i.lineTotal),
            })),
          },
        },
        include: { items: true },
      });
      for (const i of computed) {
        await applyStockChange(tx, {
          tenantId: tid,
          locationId: purchase.locationId,
          variantId: i.variantId,
          bucket: "AVAILABLE",
          delta: -i.qty,
          type: "PURCHASE_RETURN",
          referenceType: "PurchaseReturn",
          referenceId: ret.id,
          createdById: ctx.userId,
          reason,
        });
      }
      if (num(purchase.due) > 0) {
        const cut = Math.min(num(purchase.due), total);
        await tx.purchase.update({
          where: { id: purchase.id },
          data: { due: String(Math.max(num(purchase.due) - cut, 0)) },
        });
        await tx.supplier.update({
          where: { id: purchase.supplierId },
          data: { creditDue: { decrement: cut } },
        });
      }
      await enqueueOutbox(tx, {
        tenantId: tid,
        type: "PURCHASE_RETURNED",
        aggregateId: ret.id,
        payload: { branchId: purchase.branchId, number: ret.number, entityType: "PurchaseReturn", entityId: ret.id },
      });
      return ret;
    });
    await writeAudit({ ctx, action: "purchase.manage", entityType: "PurchaseReturn", entityId: row.id });
    return ok(res, row, undefined, 201);
  } catch (e) {
    const err = e as Error & { code?: string };
    return fail(res, err.code ?? "VALIDATION", err.message, err.code === "INSUFFICIENT_STOCK" ? 409 : 400);
  }
});
