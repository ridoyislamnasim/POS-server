import { Prisma, type ReturnCondition } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { nextDocNumberTx } from "../../lib/erp.js";
import { ForbiddenError, assertBranch, hasPermission, requireTenantId } from "../../lib/scope.js";
import { toMoneyString } from "../../shared/money.js";
import { completeIdempotency, d, notFound, replayOrBegin, validation } from "../../lib/http-errors.js";
import { applyStockChange } from "../inventory/stock.engine.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { acceptEnum, dateRange, parseListQuery, withPagination } from "../../lib/list-query.js";
import type { RequestContext } from "../../types.js";

type ReturnLineIn = {
  saleItemId: string;
  qty: number;
  restock?: boolean;
  reason?: string;
  notes?: string;
  condition?: ReturnCondition;
};
type ExchangeLineIn = { variantId: string; qty: number };

const HELD_RETURN_STATUSES = ["PENDING", "APPROVED", "COMPLETED"] as const;
const RESTOCK_DAMAGED: ReturnCondition[] = ["DAMAGED", "DEFECTIVE", "EXPIRED", "MISSING_PARTS"];

export function remainingReturnQty(sold: Prisma.Decimal | string | number, already: Prisma.Decimal | string | number) {
  return Prisma.Decimal.max(d(sold).minus(d(already)), 0);
}

function canApproveReturn(ctx: RequestContext) {
  return hasPermission(ctx, "sale.return.approve") || hasPermission(ctx, "refund.approve");
}

function restockFromCondition(condition: ReturnCondition, restock?: boolean) {
  if (condition === "RESTOCK_NOT_ALLOWED") return false;
  if (RESTOCK_DAMAGED.includes(condition)) return false;
  if (restock === false) return false;
  return true;
}

export function dispositionFor(condition: ReturnCondition): "AVAILABLE" | "DAMAGED" | "QUARANTINE" {
  if (condition === "RESTOCK_NOT_ALLOWED") return "QUARANTINE";
  if (RESTOCK_DAMAGED.includes(condition)) return "DAMAGED";
  return "AVAILABLE";
}

const returnInclude = {
  items: true,
  exchangeItems: true,
  payments: true,
  sale: {
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      status: true,
      customerId: true,
      locationId: true,
      customer: { select: { id: true, name: true, phone: true } },
    },
  },
} as const;

async function returnedQtyByItem(
  tx: Prisma.TransactionClient,
  saleId: string,
  statuses: readonly string[] = HELD_RETURN_STATUSES,
) {
  const posted = await tx.saleReturn.findMany({
    where: { saleId, status: { in: [...statuses] as Array<"PENDING" | "APPROVED" | "REJECTED" | "COMPLETED"> } },
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

async function lockSale(tx: Prisma.TransactionClient, saleId: string) {
  await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${saleId} FOR UPDATE`;
}

async function applyReturnLineStock(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    locationId: string;
    variantId: string;
    qty: Prisma.Decimal;
    condition: ReturnCondition;
    restock: boolean;
    saleId: string;
    returnId: string;
    userId: string;
    unitCost?: Prisma.Decimal;
  },
) {
  const bucket = dispositionFor(input.condition);
  if (bucket === "AVAILABLE") {
    if (!input.restock) {
      await applyStockChange(tx, {
        tenantId: input.tenantId,
        locationId: input.locationId,
        variantId: input.variantId,
        bucket: "QUARANTINE",
        delta: input.qty,
        type: "QUARANTINE",
        saleId: input.saleId,
        referenceType: "SaleReturn",
        referenceId: input.returnId,
        createdById: input.userId,
        unitCost: input.unitCost,
        reason: "RESTOCK_SKIPPED",
      });
      return;
    }
    await applyStockChange(tx, {
      tenantId: input.tenantId,
      locationId: input.locationId,
      variantId: input.variantId,
      bucket: "AVAILABLE",
      delta: input.qty,
      type: "SALE_RETURN",
      saleId: input.saleId,
      referenceType: "SaleReturn",
      referenceId: input.returnId,
      createdById: input.userId,
      unitCost: input.unitCost,
      reason: input.condition,
    });
    return;
  }
  if (bucket === "DAMAGED") {
    await applyStockChange(tx, {
      tenantId: input.tenantId,
      locationId: input.locationId,
      variantId: input.variantId,
      bucket: "DAMAGED",
      delta: input.qty,
      type: "DAMAGE",
      saleId: input.saleId,
      referenceType: "SaleReturn",
      referenceId: input.returnId,
      createdById: input.userId,
      unitCost: input.unitCost,
      reason: input.condition,
    });
    return;
  }
  await applyStockChange(tx, {
    tenantId: input.tenantId,
    locationId: input.locationId,
    variantId: input.variantId,
    bucket: "QUARANTINE",
    delta: input.qty,
    type: "QUARANTINE",
    saleId: input.saleId,
    referenceType: "SaleReturn",
    referenceId: input.returnId,
    createdById: input.userId,
    unitCost: input.unitCost,
    reason: "RESTOCK_NOT_ALLOWED",
  });
}

async function deductStock(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    locationId: string;
    variantId: string;
    qty: Prisma.Decimal;
    saleId: string;
    returnId: string;
    userId: string;
    allowNegative: boolean;
  },
) {
  await applyStockChange(tx, {
    tenantId: input.tenantId,
    locationId: input.locationId,
    variantId: input.variantId,
    bucket: "AVAILABLE",
    delta: input.qty.negated(),
    type: "SALE",
    saleId: input.saleId,
    referenceType: "SaleReturn",
    referenceId: input.returnId,
    createdById: input.userId,
    reason: "EXCHANGE",
    allowNegative: input.allowNegative,
  });
}

async function refreshSaleStatus(tx: Prisma.TransactionClient, saleId: string) {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
  const returned = await returnedQtyByItem(tx, saleId, ["APPROVED", "COMPLETED"]);
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

async function recordRefund(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    sale: { id: string; customerId: string | null; due: Prisma.Decimal; paid: Prisma.Decimal };
    ret: { id: string; refundMethod: string | null; refundAmount: Prisma.Decimal; refundedAmount: Prisma.Decimal; refundStatus: string };
    amount: Prisma.Decimal;
    method?: string;
    userId: string;
  },
) {
  const remaining = d(input.ret.refundAmount).minus(d(input.ret.refundedAmount));
  if (remaining.lessThanOrEqualTo(0)) {
    return { refundStatus: "REFUNDED" as const, refundedAmount: d(input.ret.refundedAmount), created: false };
  }
  if (input.amount.lessThanOrEqualTo(0)) validation("Refund amount must be positive");
  if (input.amount.greaterThan(remaining)) validation(`Only ${remaining.toString()} remaining to refund`);

  const existing = await tx.paymentTransaction.findFirst({
    where: { saleReturnId: input.ret.id, status: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] } },
    orderBy: { id: "desc" },
  });
  if (input.ret.refundStatus === "REFUNDED") {
    return { refundStatus: "REFUNDED" as const, refundedAmount: d(input.ret.refundedAmount), created: false, payment: existing };
  }

  const payment = await tx.paymentTransaction.create({
    data: {
      saleId: input.sale.id,
      saleReturnId: input.ret.id,
      method: input.method ?? input.ret.refundMethod ?? "CASH",
      provider: "manual",
      status: input.amount.lessThan(remaining) ? "PARTIALLY_REFUNDED" : "REFUNDED",
      amount: toMoneyString(input.amount),
    },
  });

  if (input.sale.customerId) {
    const customer = await tx.customer.findFirst({
      where: { id: input.sale.customerId, tenantId: input.tenantId },
    });
    if (customer && d(customer.creditDue).greaterThan(0)) {
      const cut = Prisma.Decimal.min(d(customer.creditDue), input.amount);
      await tx.customer.update({
        where: { id: customer.id },
        data: { creditDue: { decrement: cut } },
      });
    }
  }
  const saleDue = d(input.sale.due ?? 0);
  const dueCut = Prisma.Decimal.min(saleDue, input.amount);
  const paidCut = Prisma.Decimal.max(input.amount.minus(dueCut), 0);
  await tx.sale.update({
    where: { id: input.sale.id },
    data: {
      due: toMoneyString(saleDue.minus(dueCut)),
      paid: toMoneyString(Prisma.Decimal.max(d(input.sale.paid).minus(paidCut), 0)),
    },
  });

  const refundedAmount = d(input.ret.refundedAmount).plus(input.amount);
  const refundStatus = refundedAmount.greaterThanOrEqualTo(d(input.ret.refundAmount))
    ? "REFUNDED"
    : "PARTIALLY_REFUNDED";
  await tx.saleReturn.update({
    where: { id: input.ret.id },
    data: { refundedAmount: toMoneyString(refundedAmount), refundStatus },
  });
  return { refundStatus, refundedAmount, created: true, payment };
}

async function postReturn(
  tx: Prisma.TransactionClient,
  input: {
    ctx: RequestContext;
    tenantId: string;
    sale: {
      id: string;
      locationId: string;
      branch: { negativeStockPolicy: string };
      customerId: string | null;
      due: Prisma.Decimal;
      paid: Prisma.Decimal;
    };
    ret: { id: string; refundMethod: string | null; number: string };
    computed: {
      variantId: string;
      qty: Prisma.Decimal;
      restock: boolean;
      condition: ReturnCondition;
      lineRefund: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
    }[];
    exchanges: { variantId: string; qty: Prisma.Decimal }[];
  },
) {
  const allowNegative = input.sale.branch.negativeStockPolicy !== "BLOCK";
  const availableLines = [];
  const damagedLines = [];
  for (const line of input.computed) {
    const variant = await tx.productVariant.findFirst({
      where: { id: line.variantId, tenantId: input.tenantId },
      include: { product: { select: { trackInventory: true } } },
    });
    if (variant && !variant.product.trackInventory) continue;
    await applyReturnLineStock(tx, {
      tenantId: input.tenantId,
      locationId: input.sale.locationId,
      variantId: line.variantId,
      qty: line.qty,
      condition: line.condition,
      restock: line.restock,
      saleId: input.sale.id,
      returnId: input.ret.id,
      userId: input.ctx.userId,
      unitCost: variant?.cost,
    });
    const disp = dispositionFor(line.condition);
    if (disp === "AVAILABLE" && line.restock) availableLines.push(line);
    if (disp === "DAMAGED") damagedLines.push(line);
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
      allowNegative,
    });
  }

  if (availableLines.length) {
    const totalQty = availableLines.reduce((n, l) => n.plus(l.qty), d(0));
    const totalCost = availableLines.reduce((n, l) => n.plus(l.qty.mul(l.unitPrice)), d(0));
    const existing = await tx.stockReceipt.findFirst({
      where: { tenantId: input.tenantId, kind: "CUSTOMER_RETURN", sourceRef: input.ret.id },
    });
    if (!existing) {
      const number = await nextDocNumberTx(tx, input.tenantId, (await tx.saleReturn.findUniqueOrThrow({ where: { id: input.ret.id } })).branchId, "RCV", "RCV");
      const header = await tx.saleReturn.findUniqueOrThrow({ where: { id: input.ret.id } });
      await tx.stockReceipt.create({
        data: {
          tenantId: input.tenantId,
          branchId: header.branchId,
          locationId: input.sale.locationId,
          number,
          kind: "CUSTOMER_RETURN",
          status: "RECEIVED",
          saleReturnId: input.ret.id,
          sourceRef: input.ret.id,
          notes: `Auto receiving from ${input.ret.number}`,
          totalQty,
          totalCost,
          createdById: input.ctx.userId,
          receivedById: input.ctx.userId,
          receivedAt: new Date(),
          items: {
            create: availableLines.map((l) => ({
              variantId: l.variantId,
              qty: l.qty,
              unitCost: l.unitPrice,
              lineCost: l.qty.mul(l.unitPrice),
            })),
          },
        },
      });
    }
  }

  if (damagedLines.length) {
    const existing = await tx.stockDamage.findFirst({
      where: { tenantId: input.tenantId, saleReturnId: input.ret.id },
    });
    if (!existing) {
      const header = await tx.saleReturn.findUniqueOrThrow({ where: { id: input.ret.id } });
      const number = await nextDocNumberTx(tx, input.tenantId, header.branchId, "DMG", "DMG");
      const totalQty = damagedLines.reduce((n, l) => n.plus(l.qty), d(0));
      const totalCost = damagedLines.reduce((n, l) => n.plus(l.qty.mul(l.unitPrice)), d(0));
      await tx.stockDamage.create({
        data: {
          tenantId: input.tenantId,
          branchId: header.branchId,
          locationId: input.sale.locationId,
          number,
          status: "STOCK_ADJUSTED",
          reason: "CUSTOMER_RETURN_DAMAGE",
          description: `Incoming damaged goods from return ${input.ret.number}`,
          totalQty,
          totalCost,
          createdById: input.ctx.userId,
          submittedAt: new Date(),
          approvedById: input.ctx.userId,
          approvedAt: new Date(),
          saleReturnId: input.ret.id,
          items: {
            create: damagedLines.map((l) => ({
              variantId: l.variantId,
              qty: l.qty,
              unitCost: l.unitPrice,
              lineCost: l.qty.mul(l.unitPrice),
            })),
          },
        },
      });
    }
  }

  await refreshSaleStatus(tx, input.sale.id);
  await tx.auditLog.create({
    data: {
      tenantId: input.tenantId,
      userId: input.ctx.userId,
      actorUserId: input.ctx.userId,
      action: "sale.return.approve",
      entityType: "SaleReturn",
      entityId: input.ret.id,
      after: { posted: true },
    },
  });
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
  idempotencyKey?: string;
  autoRefund?: boolean;
}) {
  const tenantId = requireTenantId(input.ctx);
  if (!hasPermission(input.ctx, "sale.return")) throw new ForbiddenError("Return not permitted");
  if (!input.items.length) validation("Return items required");

  try {
    return await prisma.$transaction(async (tx) => {
      const replay = await replayOrBegin(tx, {
        tenantId,
        key: input.idempotencyKey,
        method: "POST",
        path: `/sales/${input.saleId}/returns`,
      });
      if (replay.replay) return replay.body as Prisma.SaleReturnGetPayload<{ include: typeof returnInclude }>;

      const sale = await tx.sale.findFirst({
        where: { id: input.saleId, tenantId },
        include: { items: true, payments: true, branch: true },
      });
      if (!sale) notFound("Sale not found");
      assertBranch(input.ctx, sale.branchId);
      if (sale.status === "VOIDED") validation("Cannot return a voided sale");
      if (sale.status === "DRAFT") validation("Cannot return a draft sale");
      await lockSale(tx, sale.id);

      const already = await returnedQtyByItem(tx, sale.id);
      let refundTotal = d(0);
      const computed = [];
      for (const line of input.items) {
        const item = sale.items.find((i) => i.id === line.saleItemId);
        if (!item) validation("Sale item not on this invoice");
        const qty = d(line.qty);
        if (qty.lessThanOrEqualTo(0)) validation("Qty must be positive");
        const remaining = remainingReturnQty(item.qty, already.get(item.id) ?? 0);
        if (qty.greaterThan(remaining)) {
          validation(`Only ${remaining.toString()} remaining for ${item.skuSnapshot}`);
        }
        const unit = d(item.lineTotal).div(item.qty);
        const lineRefund = unit.times(qty);
        refundTotal = refundTotal.plus(lineRefund);
        const condition = line.condition ?? "GOOD";
        computed.push({
          saleItemId: item.id,
          variantId: item.variantId,
          qty,
          unitPrice: d(item.unitPrice),
          lineRefund,
          condition,
          restock: restockFromCondition(condition, line.restock ?? input.restock),
          reason: line.reason,
          notes: line.notes,
        });
        already.set(item.id, (already.get(item.id) ?? d(0)).plus(qty));
      }

      let exchangeAmount = d(0);
      const exchanges: { variantId: string; qty: Prisma.Decimal; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }[] = [];
      if (input.kind === "EXCHANGE") {
        for (const ex of input.exchangeItems ?? []) {
          const variant = await tx.productVariant.findFirst({ where: { id: ex.variantId, tenantId } });
          if (!variant) notFound("Exchange variant not found");
          const qty = d(ex.qty);
          if (qty.lessThanOrEqualTo(0)) validation("Exchange qty must be positive");
          const lineTotal = variant.price.times(qty);
          exchangeAmount = exchangeAmount.plus(lineTotal);
          exchanges.push({ variantId: variant.id, qty, unitPrice: variant.price, lineTotal });
        }
        if (!exchanges.length) validation("Exchange items required");
      }

      const net = Prisma.Decimal.max(refundTotal.minus(exchangeAmount), 0);
      const autoApprove = canApproveReturn(input.ctx);
      const autoRefund = Boolean(autoApprove && hasPermission(input.ctx, "refund.approve") && input.autoRefund !== false);
      const number = await nextDocNumberTx(tx, tenantId, sale.branchId, "RET", "RET");
      const row = await tx.saleReturn.create({
        data: {
          tenantId,
          branchId: sale.branchId,
          saleId: sale.id,
          number,
          kind: input.kind,
          status: autoApprove ? "APPROVED" : "PENDING",
          refundStatus: "PENDING",
          reason: input.reason,
          notes: input.notes,
          refundMethod: input.refundMethod ?? sale.payments[0]?.method ?? "CASH",
          refundAmount: toMoneyString(net),
          refundedAmount: "0",
          exchangeAmount: toMoneyString(exchangeAmount),
          restock: input.restock ?? true,
          createdById: input.ctx.userId,
          approvedById: autoApprove ? input.ctx.userId : null,
          postedAt: autoApprove ? new Date() : null,
          idempotencyKey: input.idempotencyKey,
          items: {
            create: computed.map((c) => ({
              saleItemId: c.saleItemId,
              variantId: c.variantId,
              qty: c.qty,
              unitPrice: toMoneyString(c.unitPrice),
              lineRefund: toMoneyString(c.lineRefund),
              condition: c.condition,
              restock: c.restock,
              reason: c.reason,
              notes: c.notes,
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

      if (autoApprove) {
        await postReturn(tx, {
          ctx: input.ctx,
          tenantId,
          sale,
          ret: row,
          computed,
          exchanges,
        });
        if (autoRefund && net.greaterThan(0)) {
          await recordRefund(tx, {
            tenantId,
            sale,
            ret: { ...row, refundAmount: net, refundedAmount: d(0), refundStatus: "PENDING" },
            amount: net,
            userId: input.ctx.userId,
          });
          await tx.saleReturn.update({
            where: { id: row.id },
            data: { status: "COMPLETED", refundStatus: "REFUNDED", refundedAmount: toMoneyString(net) },
          });
        } else if (net.lessThanOrEqualTo(0)) {
          await tx.saleReturn.update({
            where: { id: row.id },
            data: { status: "COMPLETED", refundStatus: "APPROVED" },
          });
        }
      }

      const full = await tx.saleReturn.findFirstOrThrow({ where: { id: row.id }, include: returnInclude });
      await enqueueOutbox(tx, {
        tenantId,
        type: autoApprove ? "SALE_RETURNED" : "RETURN_APPROVAL",
        aggregateId: row.id,
        payload: {
          branchId: sale.branchId,
          invoiceNumber: sale.invoiceNumber,
          cashierUserId: input.ctx.userId,
          number: row.number,
        },
      });
      await completeIdempotency(tx, { tenantId, key: input.idempotencyKey, status: 201, body: full });
      return full;
    }, { timeout: 20_000 });
  } catch (e) {
    throw e;
  }
}

export async function decideSaleReturn(input: { ctx: RequestContext; id: string; approve: boolean; refund?: boolean }) {
  const tenantId = requireTenantId(input.ctx);
  if (!canApproveReturn(input.ctx)) throw new ForbiddenError("Approval not permitted");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "SaleReturn" WHERE id = ${input.id} FOR UPDATE`;
    const row = await tx.saleReturn.findFirst({
      where: { id: input.id, tenantId },
      include: { items: true, exchangeItems: true, sale: { include: { branch: true } } },
    });
    if (!row) notFound("Return not found");
    assertBranch(input.ctx, row.branchId);
    if (row.status !== "PENDING") validation("Return is not pending");
    if (!input.approve) {
      await enqueueOutbox(tx, {
        tenantId,
        type: "SALE_RETURNED",
        aggregateId: row.id,
        payload: {
          rejected: true,
          branchId: row.branchId,
          invoiceNumber: row.sale.invoiceNumber,
          cashierUserId: row.createdById,
          message: `Return ${row.number} was rejected.`,
        },
      });
      return tx.saleReturn.update({
        where: { id: row.id },
        data: { status: "REJECTED", refundStatus: "REJECTED", approvedById: input.ctx.userId },
        include: returnInclude,
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
        condition: i.condition,
        lineRefund: d(i.lineRefund),
        unitPrice: d(i.unitPrice),
      })),
      exchanges: row.exchangeItems.map((e) => ({ variantId: e.variantId, qty: d(e.qty) })),
    });
    await enqueueOutbox(tx, {
      tenantId,
      type: "SALE_RETURNED",
      aggregateId: row.id,
      payload: {
        branchId: row.branchId,
        invoiceNumber: row.sale.invoiceNumber,
        cashierUserId: row.createdById,
        number: row.number,
      },
    });
    const shouldRefund = input.refund !== false && hasPermission(input.ctx, "refund.approve") && d(row.refundAmount).greaterThan(0);
    if (shouldRefund) {
      await recordRefund(tx, {
        tenantId,
        sale: row.sale,
        ret: row,
        amount: d(row.refundAmount),
        userId: input.ctx.userId,
      });
      return tx.saleReturn.update({
        where: { id: row.id },
        data: {
          status: "COMPLETED",
          refundStatus: "REFUNDED",
          refundedAmount: row.refundAmount,
          approvedById: input.ctx.userId,
          postedAt: new Date(),
        },
        include: returnInclude,
      });
    }
    return tx.saleReturn.update({
      where: { id: row.id },
      data: {
        status: d(row.refundAmount).greaterThan(0) ? "APPROVED" : "COMPLETED",
        refundStatus: d(row.refundAmount).greaterThan(0) ? "PENDING" : "APPROVED",
        approvedById: input.ctx.userId,
        postedAt: new Date(),
      },
      include: returnInclude,
    });
  }, { timeout: 20_000 });
}

export async function refundSaleReturn(input: {
  ctx: RequestContext;
  id: string;
  amount?: number;
  method?: string;
  idempotencyKey?: string;
}) {
  const tenantId = requireTenantId(input.ctx);
  if (!hasPermission(input.ctx, "refund.approve")) throw new ForbiddenError("Refund not permitted");
  return prisma.$transaction(async (tx) => {
    const replay = await replayOrBegin(tx, {
      tenantId,
      key: input.idempotencyKey,
      method: "POST",
      path: `/sales/returns/${input.id}/refund`,
    });
    if (replay.replay) return replay.body as Prisma.SaleReturnGetPayload<{ include: typeof returnInclude }>;
    await tx.$queryRaw`SELECT id FROM "SaleReturn" WHERE id = ${input.id} FOR UPDATE`;
    const row = await tx.saleReturn.findFirst({
      where: { id: input.id, tenantId },
      include: { sale: true, payments: true },
    });
    if (!row) notFound("Return not found");
    assertBranch(input.ctx, row.branchId);
    if (row.status === "PENDING") validation("Approve the return before refunding");
    if (row.status === "REJECTED" || row.refundStatus === "REJECTED") validation("Rejected returns cannot be refunded");
    if (row.refundStatus === "REFUNDED") {
      await completeIdempotency(tx, { tenantId, key: input.idempotencyKey, status: 200, body: row });
      return row;
    }
    const remaining = d(row.refundAmount).minus(d(row.refundedAmount));
    const amount = input.amount != null ? d(input.amount) : remaining;
    await recordRefund(tx, {
      tenantId,
      sale: row.sale,
      ret: row,
      amount,
      method: input.method,
      userId: input.ctx.userId,
    });
    const updated = await tx.saleReturn.update({
      where: { id: row.id },
      data: {
        status: amount.greaterThanOrEqualTo(remaining) ? "COMPLETED" : row.status,
      },
      include: returnInclude,
    });
    await completeIdempotency(tx, { tenantId, key: input.idempotencyKey, status: 200, body: updated });
    return updated;
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
    if (!sale) notFound("Sale not found");
    assertBranch(input.ctx, sale.branchId);
    if (sale.status !== "COMPLETED") validation("Only completed sales can be voided");
    if (sale.returns.some((r) => r.status === "COMPLETED" || r.status === "APPROVED" || r.status === "PENDING")) {
      validation("Void blocked: sale has returns");
    }
    for (const item of sale.items) {
      const variant = await tx.productVariant.findFirst({
        where: { id: item.variantId },
        include: { product: { select: { trackInventory: true } } },
      });
      if (variant && !variant.product.trackInventory) continue;
      await applyStockChange(tx, {
        tenantId,
        locationId: sale.locationId,
        variantId: item.variantId,
        bucket: "AVAILABLE",
        delta: d(item.qty),
        type: "SALE_RETURN",
        saleId: sale.id,
        referenceType: "Sale",
        referenceId: sale.id,
        createdById: input.ctx.userId,
        reason: "VOID",
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
    await enqueueOutbox(tx, {
      tenantId,
      type: "SALE_VOIDED",
      aggregateId: sale.id,
      payload: {
        invoiceNumber: sale.invoiceNumber,
        branchId: sale.branchId,
        cashierUserId: sale.cashierId,
        reason: input.reason,
      },
    });
    return updated;
  }, { timeout: 20_000 });
}

export async function listReturns(ctx: RequestContext, query: Record<string, unknown> = {}) {
  const tenantId = requireTenantId(ctx);
  const list = parseListQuery(query, { sortable: ["createdAt", "number", "status"], defaultSort: "createdAt", defaultOrder: "desc" });
  const status = acceptEnum(query.status, ["PENDING", "APPROVED", "REJECTED", "COMPLETED"] as const);
  const refundStatus = acceptEnum(query.refundStatus, ["PENDING", "APPROVED", "REFUNDED", "PARTIALLY_REFUNDED", "REJECTED"] as const);
  const dates = dateRange(list.dateFrom, list.dateTo);
  const q = list.search;
  const where = {
    tenantId,
    ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
    ...(status ? { status } : {}),
    ...(refundStatus ? { refundStatus } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" as const } },
            { reason: { contains: q, mode: "insensitive" as const } },
            { sale: { invoiceNumber: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
  return withPagination(list, {
    find: (skip, take) =>
      prisma.saleReturn.findMany({
        where,
        include: returnInclude,
        orderBy: list.sortBy === "number" || list.sortBy === "status" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.saleReturn.count({ where }),
  });
}

export async function getReturn(ctx: RequestContext, id: string) {
  const tenantId = requireTenantId(ctx);
  const row = await prisma.saleReturn.findFirst({
    where: { id, tenantId },
    include: {
      ...returnInclude,
      sale: {
        include: {
          items: true,
          customer: { select: { id: true, name: true, phone: true, email: true, address: true, taxId: true } },
          branch: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!row) notFound("Return not found");
  assertBranch(ctx, row.branchId);
  const held = await returnedQtyByItem(prisma, row.saleId);
  return {
    ...row,
    remainingByItem: Object.fromEntries(
      row.sale.items.map((i) => [i.id, Number(d(i.qty).minus(held.get(i.id) ?? 0))]),
    ),
  };
}

export async function returnsSummary(ctx: RequestContext, query: Record<string, unknown> = {}) {
  const tenantId = requireTenantId(ctx);
  const status = acceptEnum(query.status, ["PENDING", "APPROVED", "REJECTED", "COMPLETED"] as const);
  const list = parseListQuery(query);
  const dates = dateRange(list.dateFrom, list.dateTo);
  const where = {
    tenantId,
    ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
    ...(status ? { status } : {}),
    ...(dates ? { createdAt: dates } : {}),
  };
  const rows = await prisma.saleReturn.findMany({
    where,
    include: { items: true },
    take: 2000,
  });
  const posted = rows.filter((r) => r.status === "APPROVED" || r.status === "COMPLETED");
  return {
    count: rows.length,
    posted: posted.length,
    returnedQty: posted.reduce((n, r) => n + r.items.reduce((x, i) => x + Number(i.qty), 0), 0),
    returnValue: posted.reduce((n, r) => n + r.items.reduce((x, i) => x + Number(i.lineRefund), 0), 0).toFixed(2),
    refundAmount: posted.reduce((n, r) => n + Number(r.refundedAmount), 0).toFixed(2),
    pendingRefund: rows
      .filter((r) => r.refundStatus === "PENDING" && r.status !== "REJECTED")
      .reduce((n, r) => n + Number(r.refundAmount) - Number(r.refundedAmount), 0)
      .toFixed(2),
  };
}
