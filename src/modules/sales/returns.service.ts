import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { nextDocNumber } from "../../lib/erp.js";
import { ForbiddenError, InsufficientStockError, assertBranch, hasPermission, requireTenantId } from "../../lib/scope.js";
import { toMoneyString } from "../../shared/money.js";
import type { RequestContext } from "../../types.js";

type ReturnLineIn = { saleItemId: string; qty: number; restock?: boolean; reason?: string };
type ExchangeLineIn = { variantId: string; qty: number };

function d(n: Prisma.Decimal | string | number) {
  return new Prisma.Decimal(n);
}

async function returnedQtyByItem(tx: Prisma.TransactionClient, saleId: string) {
  const posted = await tx.saleReturn.findMany({
    where: { saleId, status: { in: ["APPROVED", "COMPLETED"] } },
    include: { items: true },
  });
  const map = new Map<string, Prisma.Decimal>();
  for (const r of posted) {
    for (const line of r.items) {
      map.set(line.saleItemId, (map.get(line.saleItemId) ?? d(0)).plus(line.qty));
    }
  }
  return map;
}

async function restockLine(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; locationId: string; variantId: string; qty: Prisma.Decimal; saleId: string; returnId: string; userId: string },
) {
  await tx.stock.upsert({
    where: {
      tenantId_locationId_channel_variantId: {
        tenantId: input.tenantId,
        locationId: input.locationId,
        channel: "STORE",
        variantId: input.variantId,
      },
    },
    create: {
      tenantId: input.tenantId,
      locationId: input.locationId,
      channel: "STORE",
      variantId: input.variantId,
      quantity: input.qty,
    },
    update: { quantity: { increment: input.qty } },
  });
  await tx.stockMovement.create({
    data: {
      tenantId: input.tenantId,
      locationId: input.locationId,
      variantId: input.variantId,
      type: "SALE_RETURN",
      quantity: input.qty,
      saleId: input.saleId,
      referenceType: "SaleReturn",
      referenceId: input.returnId,
      createdById: input.userId,
    },
  });
}

async function deductStock(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; locationId: string; variantId: string; qty: Prisma.Decimal; saleId: string; returnId: string; userId: string; block: boolean },
) {
  if (input.block) {
    const locked = await tx.stock.updateMany({
      where: {
        tenantId: input.tenantId,
        locationId: input.locationId,
        variantId: input.variantId,
        quantity: { gte: input.qty },
      },
      data: { quantity: { decrement: input.qty } },
    });
    if (locked.count !== 1) throw new InsufficientStockError("Not enough stock for exchange item");
  } else {
    await tx.stock.updateMany({
      where: { tenantId: input.tenantId, locationId: input.locationId, variantId: input.variantId },
      data: { quantity: { decrement: input.qty } },
    });
  }
  await tx.stockMovement.create({
    data: {
      tenantId: input.tenantId,
      locationId: input.locationId,
      variantId: input.variantId,
      type: "SALE",
      quantity: input.qty.negated(),
      saleId: input.saleId,
      referenceType: "SaleReturn",
      referenceId: input.returnId,
      createdById: input.userId,
      reason: "EXCHANGE",
    },
  });
}

async function refreshSaleStatus(tx: Prisma.TransactionClient, saleId: string) {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
  const returned = await returnedQtyByItem(tx, saleId);
  let all = true;
  let any = false;
  for (const item of sale.items) {
    const used = returned.get(item.id) ?? d(0);
    if (used.greaterThan(0)) any = true;
    if (used.lessThan(item.qty)) all = false;
  }
  const status = !any ? sale.status : all ? "FULLY_RETURNED" : "PARTIALLY_RETURNED";
  if (status !== sale.status && (any || sale.status === "COMPLETED")) {
    await tx.sale.update({ where: { id: saleId }, data: { status } });
  }
  return status;
}

export async function createSaleReturn(input: {
  ctx: RequestContext;
  saleId: string;
  kind: "RETURN" | "EXCHANGE";
  reason: string;
  notes?: string;
  refundMethod?: string;
  restock?: boolean;
  items: ReturnLineIn[];
  exchangeItems?: ExchangeLineIn[];
}) {
  const tenantId = requireTenantId(input.ctx);
  if (!hasPermission(input.ctx, "sale.return")) throw new ForbiddenError("Return not permitted");
  if (!input.items.length) throw Object.assign(new Error("Return items required"), { code: "VALIDATION" });

  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: input.saleId, tenantId },
      include: { items: true, payments: true, branch: true },
    });
    if (!sale) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });
    assertBranch(input.ctx, sale.branchId);
    if (sale.status === "VOIDED") throw Object.assign(new Error("Cannot return a voided sale"), { code: "VALIDATION" });
    if (sale.status === "DRAFT") throw Object.assign(new Error("Cannot return a draft sale"), { code: "VALIDATION" });

    const already = await returnedQtyByItem(tx, sale.id);
    let refundTotal = d(0);
    const computed = [];
    for (const line of input.items) {
      const item = sale.items.find((i) => i.id === line.saleItemId);
      if (!item) throw Object.assign(new Error("Sale item not on this invoice"), { code: "VALIDATION" });
      const qty = d(line.qty);
      if (qty.lessThanOrEqualTo(0)) throw Object.assign(new Error("Qty must be positive"), { code: "VALIDATION" });
      const remaining = d(item.qty).minus(already.get(item.id) ?? 0);
      if (qty.greaterThan(remaining)) {
        throw Object.assign(new Error(`Only ${remaining.toString()} remaining for ${item.skuSnapshot}`), { code: "VALIDATION" });
      }
      const unit = d(item.lineTotal).div(item.qty);
      const lineRefund = unit.times(qty);
      refundTotal = refundTotal.plus(lineRefund);
      computed.push({
        saleItemId: item.id,
        variantId: item.variantId,
        qty,
        lineRefund,
        restock: line.restock ?? input.restock ?? true,
        reason: line.reason,
      });
    }

    let exchangeAmount = d(0);
    const exchanges: { variantId: string; qty: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }[] = [];
    if (input.kind === "EXCHANGE") {
      for (const ex of input.exchangeItems ?? []) {
        const variant = await tx.productVariant.findFirst({ where: { id: ex.variantId, tenantId } });
        if (!variant) throw Object.assign(new Error("Exchange variant not found"), { code: "NOT_FOUND" });
        const qty = d(ex.qty);
        if (qty.lessThanOrEqualTo(0)) throw Object.assign(new Error("Exchange qty must be positive"), { code: "VALIDATION" });
        const lineTotal = variant.price.times(qty);
        exchangeAmount = exchangeAmount.plus(lineTotal);
        exchanges.push({ variantId: variant.id, qty, unitPrice: variant.price, lineTotal });
      }
      if (!exchanges.length) throw Object.assign(new Error("Exchange items required"), { code: "VALIDATION" });
    }

    const net = Prisma.Decimal.max(refundTotal.minus(exchangeAmount), 0);
    const autoPost = hasPermission(input.ctx, "refund.approve");
    const number = await nextDocNumber(tenantId, sale.branchId, "RET", "RET");
    const row = await tx.saleReturn.create({
      data: {
        tenantId,
        branchId: sale.branchId,
        saleId: sale.id,
        number,
        kind: input.kind,
        status: autoPost ? "COMPLETED" : "PENDING",
        reason: input.reason,
        notes: input.notes,
        refundMethod: input.refundMethod ?? sale.payments[0]?.method ?? "CASH",
        refundAmount: toMoneyString(net),
        exchangeAmount: toMoneyString(exchangeAmount),
        restock: input.restock ?? true,
        createdById: input.ctx.userId,
        approvedById: autoPost ? input.ctx.userId : null,
        postedAt: autoPost ? new Date() : null,
        items: {
          create: computed.map((c) => ({
            saleItemId: c.saleItemId,
            variantId: c.variantId,
            qty: c.qty,
            lineRefund: toMoneyString(c.lineRefund),
            restock: c.restock,
            reason: c.reason,
          })),
        },
        exchangeItems: {
          create: exchanges.map((e) => ({
            variantId: e.variantId,
            qty: e.qty,
            unitPrice: toMoneyString(e.unitPrice),
            lineTotal: toMoneyString(e.lineTotal),
          })),
        },
      },
      include: { items: true, exchangeItems: true },
    });

    if (autoPost) {
      await postReturn(tx, {
        ctx: input.ctx,
        tenantId,
        sale,
        ret: row,
        computed,
        exchanges,
        net,
      });
    }

    return tx.saleReturn.findFirstOrThrow({
      where: { id: row.id },
      include: { items: true, exchangeItems: true, payments: true, sale: { select: { invoiceNumber: true, status: true } } },
    });
  }, { timeout: 20_000 });
}

async function postReturn(
  tx: Prisma.TransactionClient,
  input: {
    ctx: RequestContext;
    tenantId: string;
    sale: { id: string; locationId: string; branch: { negativeStockPolicy: string }; customerId: string | null };
    ret: { id: string; refundMethod: string | null };
    computed: { variantId: string; qty: Prisma.Decimal; restock: boolean; lineRefund: Prisma.Decimal }[];
    exchanges: { variantId: string; qty: Prisma.Decimal }[];
    net: Prisma.Decimal;
  },
) {
  const block = input.sale.branch.negativeStockPolicy === "BLOCK";
  for (const line of input.computed) {
    if (!line.restock) continue;
    await restockLine(tx, {
      tenantId: input.tenantId,
      locationId: input.sale.locationId,
      variantId: line.variantId,
      qty: line.qty,
      saleId: input.sale.id,
      returnId: input.ret.id,
      userId: input.ctx.userId,
    });
  }
  for (const ex of input.exchanges) {
    await deductStock(tx, {
      tenantId: input.tenantId,
      locationId: input.sale.locationId,
      variantId: ex.variantId,
      qty: ex.qty,
      saleId: input.sale.id,
      returnId: input.ret.id,
      userId: input.ctx.userId,
      block,
    });
  }
  if (input.net.greaterThan(0)) {
    await tx.paymentTransaction.create({
      data: {
        saleId: input.sale.id,
        saleReturnId: input.ret.id,
        method: input.ret.refundMethod ?? "CASH",
        provider: "manual",
        status: "REFUNDED",
        amount: toMoneyString(input.net),
      },
    });
    if (input.sale.customerId) {
      const customer = await tx.customer.findFirst({ where: { id: input.sale.customerId } });
      if (customer && d(customer.creditDue).greaterThan(0)) {
        const cut = Prisma.Decimal.min(d(customer.creditDue), input.net);
        await tx.customer.update({
          where: { id: customer.id },
          data: { creditDue: { decrement: cut } },
        });
      }
    }
  }
  await refreshSaleStatus(tx, input.sale.id);
  await tx.auditLog.create({
    data: {
      tenantId: input.tenantId,
      userId: input.ctx.userId,
      actorUserId: input.ctx.userId,
      action: "refund.approve",
      entityType: "SaleReturn",
      entityId: input.ret.id,
      after: { net: toMoneyString(input.net) },
    },
  });
}

export async function decideSaleReturn(input: { ctx: RequestContext; id: string; approve: boolean }) {
  const tenantId = requireTenantId(input.ctx);
  if (!hasPermission(input.ctx, "refund.approve")) throw new ForbiddenError("Approval not permitted");
  return prisma.$transaction(async (tx) => {
    const row = await tx.saleReturn.findFirst({
      where: { id: input.id, tenantId },
      include: { items: true, exchangeItems: true, sale: { include: { branch: true } } },
    });
    if (!row) throw Object.assign(new Error("Return not found"), { code: "NOT_FOUND" });
    assertBranch(input.ctx, row.branchId);
    if (row.status !== "PENDING") throw Object.assign(new Error("Return is not pending"), { code: "VALIDATION" });
    if (!input.approve) {
      return tx.saleReturn.update({
        where: { id: row.id },
        data: { status: "REJECTED", approvedById: input.ctx.userId },
        include: { items: true, exchangeItems: true },
      });
    }
    await postReturn(tx, {
      ctx: input.ctx,
      tenantId,
      sale: row.sale,
      ret: row,
      computed: row.items.map((i) => ({
        variantId: i.variantId,
        qty: d(i.qty),
        restock: i.restock,
        lineRefund: d(i.lineRefund),
      })),
      exchanges: row.exchangeItems.map((e) => ({ variantId: e.variantId, qty: d(e.qty) })),
      net: d(row.refundAmount),
    });
    return tx.saleReturn.update({
      where: { id: row.id },
      data: { status: "COMPLETED", approvedById: input.ctx.userId, postedAt: new Date() },
      include: { items: true, exchangeItems: true, payments: true },
    });
  }, { timeout: 20_000 });
}

export async function voidSale(input: { ctx: RequestContext; saleId: string; reason: string }) {
  const tenantId = requireTenantId(input.ctx);
  if (!hasPermission(input.ctx, "sale.void")) throw new ForbiddenError("Void not permitted");
  return prisma.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({
      where: { id: input.saleId, tenantId },
      include: { items: true, payments: true, returns: true, branch: true },
    });
    if (!sale) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });
    assertBranch(input.ctx, sale.branchId);
    if (sale.status !== "COMPLETED") throw Object.assign(new Error("Only completed sales can be voided"), { code: "VALIDATION" });
    if (sale.returns.some((r) => r.status === "COMPLETED" || r.status === "APPROVED" || r.status === "PENDING")) {
      throw Object.assign(new Error("Void blocked: sale has returns"), { code: "VALIDATION" });
    }
    for (const item of sale.items) {
      await restockLine(tx, {
        tenantId,
        locationId: sale.locationId,
        variantId: item.variantId,
        qty: d(item.qty),
        saleId: sale.id,
        returnId: sale.id,
        userId: input.ctx.userId,
      });
    }
    await tx.paymentTransaction.updateMany({
      where: { saleId: sale.id, status: "CAPTURED" },
      data: { status: "CANCELLED" },
    });
    if (sale.customerId && d(sale.due).greaterThan(0)) {
      await tx.customer.update({
        where: { id: sale.customerId },
        data: { creditDue: { decrement: sale.due } },
      });
    }
    const pts = await tx.loyaltyTransaction.findMany({ where: { saleId: sale.id, type: "EARN" } });
    const claw = pts.reduce((n, p) => n + p.points, 0);
    if (sale.customerId && claw > 0) {
      await tx.loyaltyTransaction.create({
        data: {
          tenantId,
          customerId: sale.customerId,
          type: "ADJUST",
          points: -claw,
          saleId: sale.id,
          notes: `Void ${sale.invoiceNumber}: ${input.reason}`,
        },
      });
      await tx.customer.update({
        where: { id: sale.customerId },
        data: { loyaltyPoints: { decrement: claw } },
      });
    }
    const updated = await tx.sale.update({
      where: { id: sale.id },
      data: { status: "VOIDED" },
      include: { items: true, payments: true },
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: input.ctx.userId,
        actorUserId: input.ctx.userId,
        action: "sale.void",
        entityType: "Sale",
        entityId: sale.id,
        after: { reason: input.reason },
      },
    });
    return updated;
  }, { timeout: 20_000 });
}

export async function listReturns(ctx: RequestContext) {
  const tenantId = requireTenantId(ctx);
  return prisma.saleReturn.findMany({
    where: {
      tenantId,
      ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
    },
    include: {
      sale: { select: { invoiceNumber: true, total: true } },
      items: true,
      exchangeItems: true,
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}
