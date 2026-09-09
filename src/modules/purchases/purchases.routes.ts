import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { branchScope, nextDocNumber, num, tenantId } from "../../lib/erp.js";
import { assertBranch } from "../../lib/scope.js";
import type { AuthedRequest } from "../../types.js";

export const purchasesRouter = Router();
purchasesRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

purchasesRouter.get("/", requirePermission("purchase.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.purchase.findMany({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx) },
    include: { supplier: true, branch: { select: { name: true } }, items: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok(res, rows);
});

purchasesRouter.get("/orders", requirePermission("purchase.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.purchaseOrder.findMany({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx) },
    include: { supplier: true, branch: { select: { name: true } }, items: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok(res, rows);
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
  return ok(res, row, undefined, 201);
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
  const computed = items.map((i: { variantId: string; qty: number; unitCost: number; taxRate?: number }) => {
    const qty = num(i.qty);
    const cost = num(i.unitCost);
    const taxRate = num(i.taxRate);
    const line = qty * cost;
    const taxAmount = line * (taxRate / 100);
    return { variantId: i.variantId, qty, unitCost: cost, taxRate, taxAmount, lineTotal: line + taxAmount };
  });
  const subtotal = computed.reduce((n, i) => n + i.qty * i.unitCost, 0);
  const tax = computed.reduce((n, i) => n + i.taxAmount, 0);
  const total = subtotal + tax;
  const paidAmt = num(paid);
  const due = Math.max(total - paidAmt, 0);
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
      await tx.stock.upsert({
        where: {
          tenantId_locationId_channel_variantId: {
            tenantId: tid,
            locationId: loc,
            channel: "STORE",
            variantId: i.variantId,
          },
        },
        create: {
          tenantId: tid,
          locationId: loc,
          channel: "STORE",
          variantId: i.variantId,
          quantity: String(i.qty),
        },
        update: { quantity: { increment: i.qty } },
      });
      await tx.stockMovement.create({
        data: {
          tenantId: tid,
          locationId: loc,
          variantId: i.variantId,
          type: "PURCHASE",
          quantity: String(i.qty),
          referenceType: "Purchase",
          referenceId: purchase.id,
          createdById: ctx.userId,
        },
      });
    }
    if (due > 0) {
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
    return purchase;
  });
  await writeAudit({ ctx, action: "purchase.create", entityType: "Purchase", entityId: row.id });
  return ok(res, row, undefined, 201);
});

purchasesRouter.get("/returns", requirePermission("purchase.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.purchaseReturn.findMany({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx) },
    include: { purchase: { select: { invoiceNumber: true } }, items: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return ok(res, rows);
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
      const computed = items.map((i: { purchaseItemId: string; qty: number }) => {
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
        const locked = await tx.stock.updateMany({
          where: {
            tenantId: tid,
            locationId: purchase.locationId,
            variantId: i.variantId,
            quantity: { gte: i.qty },
          },
          data: { quantity: { decrement: i.qty } },
        });
        if (locked.count !== 1) {
          throw Object.assign(new Error("Not enough stock to return to supplier"), { code: "INSUFFICIENT_STOCK" });
        }
        await tx.stockMovement.create({
          data: {
            tenantId: tid,
            locationId: purchase.locationId,
            variantId: i.variantId,
            type: "PURCHASE_RETURN",
            quantity: String(-i.qty),
            referenceType: "PurchaseReturn",
            referenceId: ret.id,
            createdById: ctx.userId,
            reason,
          },
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
      return ret;
    });
    await writeAudit({ ctx, action: "purchase.manage", entityType: "PurchaseReturn", entityId: row.id });
    return ok(res, row, undefined, 201);
  } catch (e) {
    const err = e as Error & { code?: string };
    return fail(res, err.code ?? "VALIDATION", err.message, err.code === "INSUFFICIENT_STOCK" ? 409 : 400);
  }
});
