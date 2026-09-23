import { Prisma } from "@prisma/client";
import { writeAudit } from "../../lib/audit.js";
import { branchScope, nextDocNumber, num, tenantId } from "../../lib/erp.js";
import { acceptEnum, acceptId, createdAtRange, ilike, parseListQuery, scopedBranchId, withPagination } from "../../lib/list-query.js";
import { prisma } from "../../lib/prisma.js";
import { assertBranch } from "../../lib/scope.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { applyStockChange } from "../inventory/stock.engine.js";
import { linkPurchaseReceipt } from "../inventory/receipts.service.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { purchasesRepository } from "./purchases.repository.js";
import type { CreateOrderInput, ReceivePurchaseInput } from "./purchases.types.js";

/** Purchase orders + goods-receipt business logic. No Express `req`/`res`. */
export const purchasesService = {
  async list(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "invoiceNumber", "total", "status"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const status = acceptEnum(query.status, ["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"] as const);
    const supplierId = acceptId(query.supplierId);
    const branchId = scopedBranchId(ctx, query.branchId);
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
    return withPagination(list, {
      find: (skip, take) =>
        purchasesRepository.listPurchases({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "invoiceNumber" || list.sortBy === "total" || list.sortBy === "status"
              ? { [list.sortBy]: list.sortOrder }
              : { createdAt: list.sortOrder },
        }),
      count: () => purchasesRepository.countPurchases(where),
    });
  },

  async listOrders(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "number", "total", "status"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const status = acceptEnum(query.status, ["DRAFT", "ORDERED", "PARTIAL", "RECEIVED", "CANCELLED"] as const);
    const supplierId = acceptId(query.supplierId);
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
    return withPagination(list, {
      find: (skip, take) =>
        purchasesRepository.listOrders({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "number" || list.sortBy === "total" || list.sortBy === "status"
              ? { [list.sortBy]: list.sortOrder }
              : { createdAt: list.sortOrder },
        }),
      count: () => purchasesRepository.countOrders(where),
    });
  },

  async getOrder(ctx: RequestContext, id: string) {
    const row = await purchasesRepository.findOrder(id, tenantId(ctx));
    if (!row) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
    return row;
  },

  async createOrder(ctx: RequestContext, input: CreateOrderInput) {
    const { branchId, supplierId, notes, expectedAt, items } = input;
    if (!branchId || !supplierId || !Array.isArray(items) || !items.length) {
      throw new AppError("VALIDATION", "branchId, supplierId, items required", 400);
    }
    assertBranch(ctx, branchId);
    const tid = tenantId(ctx);
    // merge duplicate variants intelligently
    const poMerged = new Map<string, typeof items[number]>();
    for (const it of items) {
      const k = String(it.variantId);
      const ex = poMerged.get(k);
      if (ex) {
        ex.qty = Number((ex as unknown as { qty: number }).qty) + Number((it as unknown as { qty: number }).qty);
        if ((it as unknown as { unitCost: unknown }).unitCost != null) (ex as unknown as { unitCost: number }).unitCost = Number((it as unknown as { unitCost: number }).unitCost);
        if ((it as unknown as { taxRate?: number }).taxRate != null) (ex as unknown as { taxRate: number }).taxRate = Number((it as unknown as { taxRate: number }).taxRate);
      } else poMerged.set(k, { ...it });
    }
    const mergedOrderItems = [...poMerged.values()];
    const computed = mergedOrderItems.map((i) => {
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
    const row = await purchasesRepository.createOrder({
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
    });
    await enqueueOutbox(prisma, {
      tenantId: tid,
      type: "PURCHASE_CREATED",
      aggregateId: row.id,
      payload: { branchId, number: row.number, entityType: "PurchaseOrder", entityId: row.id },
    });
    return row;
  },

  async cancelOrder(ctx: RequestContext, id: string) {
    const existing = await purchasesRepository.findOrder(id, tenantId(ctx), true);
    if (!existing) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
    if (existing.purchases.length) throw new AppError("CONFLICT", "This PO already has receipts", 409);
    if (existing.status === "CANCELLED") throw new AppError("CONFLICT", "Already cancelled", 409);
    const row = await purchasesRepository.cancelOrder(existing.id);
    await writeAudit({ ctx, action: "purchase.order.cancel", entityType: "PurchaseOrder", entityId: row.id });
    await enqueueOutbox(prisma, {
      tenantId: tenantId(ctx),
      type: "PURCHASE_CANCELLED",
      aggregateId: row.id,
      payload: { branchId: row.branchId, number: row.number, entityType: "PurchaseOrder", entityId: row.id },
    });
    return row;
  },

  async receive(ctx: RequestContext, input: ReceivePurchaseInput) {
    const { branchId, locationId, supplierId, purchaseOrderId, paid, notes, items } = input;
    if (!branchId || !supplierId || !Array.isArray(items) || !items.length) {
      throw new AppError("VALIDATION", "branchId, supplierId, items required", 400);
    }
    assertBranch(ctx, branchId);
    const tid = tenantId(ctx);
    const branch = await purchasesRepository.findBranch(branchId, tid);
    if (!branch) throw new AppError("NOT_FOUND", "Branch not found", 404);
    const loc = locationId || branch.locationId;
    // intelligent merge: same variant added twice sums qty, keeps last price — prevents accidental duplicate lines
    const mergedMap = new Map<string, typeof items[number]>();
    for (const it of items) {
      const key = String(it.variantId);
      const ex = mergedMap.get(key);
      if (ex) {
        ex.qty = Number((ex as unknown as { qty: number }).qty) + Number((it as unknown as { qty: number }).qty);
        if ((it as unknown as { unitCost: unknown }).unitCost != null) (ex as unknown as { unitCost: number }).unitCost = Number((it as unknown as { unitCost: number }).unitCost);
        if ((it as unknown as { taxRate?: number }).taxRate != null) (ex as unknown as { taxRate: number }).taxRate = Number((it as unknown as { taxRate: number }).taxRate);
        if ((it as unknown as { retailPrice?: number }).retailPrice != null) (ex as unknown as { retailPrice: number }).retailPrice = Number((it as unknown as { retailPrice: number }).retailPrice);
        if ((it as unknown as { wholesalePrice?: number }).wholesalePrice != null)
          (ex as unknown as { wholesalePrice: number }).wholesalePrice = Number((it as unknown as { wholesalePrice: number }).wholesalePrice);
      } else mergedMap.set(key, { ...it });
    }
    const mergedItems = [...mergedMap.values()];
    const ids = [...new Set(mergedItems.map((i) => i.variantId).filter(Boolean))];
    const owned = await purchasesRepository.countVariants(tid, ids);
    if (owned.length !== ids.length) throw new AppError("FORBIDDEN", "Variant not in tenant", 403);

    const computed = mergedItems.map((i) => {
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
      // Optional selling-price updates per variant (inherited vs overridden — only if supplied)
      for (const raw of mergedItems) {
        const rp = (raw as unknown as { retailPrice?: number }).retailPrice;
        const wp = (raw as unknown as { wholesalePrice?: number }).wholesalePrice;
        if (rp != null || wp != null) {
          const data: Record<string, string> = {};
          if (rp != null && Number.isFinite(Number(rp))) data.retailPrice = String(rp);
          if (wp != null && Number.isFinite(Number(wp))) data.wholesalePrice = String(wp);
          if (Object.keys(data).length) {
            await tx.productVariant.update({ where: { id: raw.variantId }, data });
          }
        }
      }
      if (due.greaterThan(0)) {
        await tx.supplier.update({
          where: { id: supplierId },
          data: { creditDue: { increment: due } },
        });
      }
      if (purchaseOrderId) {
        const po = await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId, tenantId: tid }, include: { items: true } });
        if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
        if (po.status === "CANCELLED") throw new AppError("CONFLICT", "Cannot receive against cancelled PO", 409);
        if (po.status === "RECEIVED") throw new AppError("CONFLICT", "PO already fully received", 409);
        const poMap = new Map(po.items.map((it) => [it.variantId, it] as const));
        for (const it of computed) {
          const poItem = poMap.get(it.variantId);
          if (!poItem) continue; // allow extra variants not in PO without PO tracking
          const ordered = new Prisma.Decimal(String(poItem.qty));
          const already = new Prisma.Decimal(String(poItem.receivedQty));
          const remaining = ordered.minus(already);
          if (it.qty.greaterThan(remaining)) {
            throw new AppError(
              "VALIDATION",
              `Over-receiving variant ${poItem.variantId}: ordered ${ordered.toString()}, received ${already.toString()}, remaining ${remaining.toString()}, tried ${it.qty.toString()}`,
              400,
            );
          }
        }
        for (const it of computed) {
          const poItem = poMap.get(it.variantId);
          if (!poItem) continue;
          await tx.purchaseOrderItem.update({ where: { id: poItem.id }, data: { receivedQty: { increment: it.qty } } });
        }
        const updatedPo = await tx.purchaseOrder.findFirst({ where: { id: purchaseOrderId }, include: { items: true } });
        const totalOrdered = updatedPo!.items.reduce((s, it) => s.plus(new Prisma.Decimal(String(it.qty))), new Prisma.Decimal(0));
        const totalReceived = updatedPo!.items.reduce((s, it) => s.plus(new Prisma.Decimal(String(it.receivedQty))), new Prisma.Decimal(0));
        const newStatus: string = totalReceived.greaterThanOrEqualTo(totalOrdered) ? "RECEIVED" : totalReceived.greaterThan(0) ? "PARTIAL" : "ORDERED";
        await tx.purchaseOrder.update({ where: { id: purchaseOrderId }, data: { status: newStatus as never } });
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
    return row;
  },

  async getById(ctx: RequestContext, id: string) {
    const row = await purchasesRepository.findPurchaseDetail(id, tenantId(ctx));
    if (!row) throw new AppError("NOT_FOUND", "Purchase not found", 404);
    return row;
  },
};
