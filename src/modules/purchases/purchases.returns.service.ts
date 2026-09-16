import { writeAudit } from "../../lib/audit.js";
import { branchScope, nextDocNumber, num, tenantId } from "../../lib/erp.js";
import { createdAtRange, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { prisma } from "../../lib/prisma.js";
import { assertBranch } from "../../lib/scope.js";
import type { RequestContext } from "../../types.js";
import { applyStockChange } from "../inventory/stock.engine.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { purchasesRepository } from "./purchases.repository.js";
import type { CreatePurchaseReturnInput } from "./purchases.types.js";

/**
 * Purchase-return logic, split from `purchases.service.ts` because
 * return settlement is a separate responsibility.
 * No Express `req`/`res` here.
 */
export const purchaseReturnsService = {
  async list(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "number"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const q = list.search;
    const dates = createdAtRange(list);
    const where = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      ...(dates ? { createdAt: dates } : {}),
      ...(q
        ? { OR: [{ number: ilike(q) }, { reason: ilike(q) }, { purchase: { invoiceNumber: ilike(q) } }] }
        : {}),
    };
    return withPagination(list, {
      find: (skip, take) => purchasesRepository.listReturns({ where, skip, take, order: list.sortOrder }),
      count: () => purchasesRepository.countReturns(where),
    });
  },

  async create(ctx: RequestContext, purchaseId: string, input: CreatePurchaseReturnInput) {
    const reason = String(input.reason ?? "").trim();
    const items = Array.isArray(input.items) ? input.items : [];
    if (!reason || !items.length) {
      throw Object.assign(new Error("reason and items required"), { code: "VALIDATION" });
    }
    const tid = tenantId(ctx);
    try {
      const row = await prisma.$transaction(async (tx) => {
        const purchase = await tx.purchase.findFirst({
          where: { id: purchaseId, tenantId: tid },
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
        const computed: { purchaseItemId: string; variantId: string; qty: number; unitCost: number; lineTotal: number }[] =
          items.map((i) => {
            const item = purchase.items.find((p) => p.id === i.purchaseItemId);
            if (!item) throw Object.assign(new Error("Purchase item not found"), { code: "VALIDATION" });
            const qty = num(i.qty);
            const remaining = num(item.qty) - (used.get(item.id) ?? 0);
            if (qty <= 0 || qty > remaining) {
              throw Object.assign(new Error(`Invalid qty for ${item.variantId}`), { code: "VALIDATION" });
            }
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
            notes: input.notes ?? null,
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
      return row;
    } catch (e) {
      // Preserve the legacy error mapping (INSUFFICIENT_STOCK -> 409).
      throw e;
    }
  },
};
