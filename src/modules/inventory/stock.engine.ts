import { Prisma, type StockBucket, type StockMovementType } from "@prisma/client";
import { InsufficientStockError } from "../../lib/scope.js";
import { d, validation } from "../../lib/http-errors.js";
import { evaluateStockAlert } from "../notifications/stock-alert.js";

export type StockBuckets = {
  onHand: Prisma.Decimal;
  reserved: Prisma.Decimal;
  available: Prisma.Decimal;
  damaged: Prisma.Decimal;
  quarantine: Prisma.Decimal;
  physical: Prisma.Decimal;
};

export function readBuckets(row: {
  quantity: Prisma.Decimal;
  reservedQuantity?: Prisma.Decimal | null;
  damagedQuantity?: Prisma.Decimal | null;
  quarantineQuantity?: Prisma.Decimal | null;
}): StockBuckets {
  const onHand = d(row.quantity);
  const reserved = d(row.reservedQuantity ?? 0);
  const damaged = d(row.damagedQuantity ?? 0);
  const quarantine = d(row.quarantineQuantity ?? 0);
  return {
    onHand,
    reserved,
    available: onHand.minus(reserved),
    damaged,
    quarantine,
    physical: onHand.plus(damaged).plus(quarantine),
  };
}

export function mapStockTotals(row: {
  quantity: Prisma.Decimal;
  reservedQuantity?: Prisma.Decimal | null;
  damagedQuantity?: Prisma.Decimal | null;
  quarantineQuantity?: Prisma.Decimal | null;
  unitCost?: Prisma.Decimal | null;
}) {
  const b = readBuckets(row);
  const cost = Number(row.unitCost ?? 0);
  return {
    onHand: Number(b.onHand),
    reserved: Number(b.reserved),
    available: Number(b.available),
    damaged: Number(b.damaged),
    quarantine: Number(b.quarantine),
    physical: Number(b.physical),
    unitCost: cost,
    availableValue: Number(b.available.mul(cost).toFixed(2)),
    damagedValue: Number(b.damaged.mul(cost).toFixed(2)),
    physicalValue: Number(b.physical.mul(cost).toFixed(2)),
  };
}

async function lockOrCreateStock(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; locationId: string; variantId: string },
) {
  const key = {
    tenantId: input.tenantId,
    locationId: input.locationId,
    channel: "STORE" as const,
    variantId: input.variantId,
  };
  let row = await tx.stock.findUnique({ where: { tenantId_locationId_channel_variantId: key } });
  if (!row) {
    try {
      row = await tx.stock.create({
        data: {
          tenantId: input.tenantId,
          locationId: input.locationId,
          channel: "STORE",
          variantId: input.variantId,
          quantity: 0,
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      row = await tx.stock.findUniqueOrThrow({ where: { tenantId_locationId_channel_variantId: key } });
    }
  }
  await tx.$queryRaw`SELECT id FROM "Stock" WHERE id = ${row.id} FOR UPDATE`;
  return tx.stock.findUniqueOrThrow({ where: { id: row.id } });
}

export async function applyStockChange(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    locationId: string;
    variantId: string;
    bucket: StockBucket;
    delta: Prisma.Decimal | string | number;
    type: StockMovementType;
    reason?: string;
    notes?: string;
    saleId?: string;
    referenceType?: string;
    referenceId?: string;
    createdById?: string;
    unitCost?: Prisma.Decimal | string | number | null;
    allowNegative?: boolean;
  },
) {
  const delta = d(input.delta);
  if (delta.equals(0)) validation("Stock change cannot be zero");
  const stock = await lockOrCreateStock(tx, input);
  const buckets = readBuckets(stock);
  let before: Prisma.Decimal;
  const data: Prisma.StockUpdateInput = {};

  if (input.bucket === "AVAILABLE") {
    before = buckets.onHand;
    const afterOnHand = before.plus(delta);
    const availableAfter = afterOnHand.minus(buckets.reserved);
    if (delta.isNegative() && !input.allowNegative && availableAfter.lessThan(0)) {
      throw new InsufficientStockError("Not enough available stock");
    }
    data.quantity = afterOnHand;
    if (delta.isPositive() && input.unitCost != null) {
      const incomingCost = d(input.unitCost);
      const newQty = afterOnHand;
      if (newQty.greaterThan(0)) {
        const oldValue = before.mul(stock.unitCost);
        const inValue = delta.mul(incomingCost);
        data.unitCost = oldValue.plus(inValue).div(newQty);
      } else {
        data.unitCost = incomingCost;
      }
    }
  } else if (input.bucket === "DAMAGED") {
    before = buckets.damaged;
    const after = before.plus(delta);
    if (after.lessThan(0)) throw new InsufficientStockError("Damaged stock cannot go negative");
    data.damagedQuantity = after;
  } else {
    before = buckets.quarantine;
    const after = before.plus(delta);
    if (after.lessThan(0)) throw new InsufficientStockError("Quarantine stock cannot go negative");
    data.quarantineQuantity = after;
  }

  const after = before.plus(delta);
  const updated = await tx.stock.update({ where: { id: stock.id }, data });
  const nextBuckets = readBuckets(updated);
  if (input.bucket === "AVAILABLE") {
    await evaluateStockAlert(tx, {
      tenantId: input.tenantId,
      locationId: input.locationId,
      variantId: input.variantId,
      available: nextBuckets.available,
    });
  }
  const unitCost = d(input.unitCost ?? updated.unitCost ?? 0);
  const movement = await tx.stockMovement.create({
    data: {
      tenantId: input.tenantId,
      locationId: input.locationId,
      variantId: input.variantId,
      type: input.type,
      bucket: input.bucket,
      quantity: delta,
      beforeQuantity: before,
      afterQuantity: after,
      unitCost,
      value: delta.abs().mul(unitCost),
      saleId: input.saleId,
      reason: input.reason,
      notes: input.notes,
      createdById: input.createdById,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    },
  });
  return { stock: updated, before, after, movement, buckets: nextBuckets };
}

export async function moveAvailableToDamaged(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    locationId: string;
    variantId: string;
    qty: Prisma.Decimal | string | number;
    reason?: string;
    notes?: string;
    referenceType?: string;
    referenceId?: string;
    createdById?: string;
    allowNegative?: boolean;
  },
) {
  const qty = d(input.qty);
  const out = await applyStockChange(tx, {
    ...input,
    bucket: "AVAILABLE",
    delta: qty.negated(),
    type: "DAMAGE",
    unitCost: undefined,
  });
  const inn = await applyStockChange(tx, {
    ...input,
    bucket: "DAMAGED",
    delta: qty,
    type: "DAMAGE",
    unitCost: out.stock.unitCost,
  });
  return { available: out, damaged: inn };
}
