import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { nextStockLevel, shouldNotifyStockCrossing } from "./crossing.js";

export async function evaluateStockAlert(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    locationId: string;
    variantId: string;
    available: Prisma.Decimal | number | string;
    threshold?: number;
  },
) {
  const threshold =
    input.threshold ??
    (await tx.tenantSettings.findUnique({ where: { tenantId: input.tenantId } }))?.lowStockThreshold ??
    5;
  const available = Number(input.available);
  const next = nextStockLevel(Number.isFinite(available) ? available : 0, threshold);
  const key = {
    tenantId: input.tenantId,
    locationId: input.locationId,
    channel: "STORE" as const,
    variantId: input.variantId,
  };
  let state = await tx.stockAlertState.findUnique({ where: { tenantId_locationId_channel_variantId: key } });
  if (state) {
    await tx.$queryRaw`SELECT id FROM "StockAlertState" WHERE id = ${state.id} FOR UPDATE`;
    state = await tx.stockAlertState.findUniqueOrThrow({ where: { id: state.id } });
  }
  const prev = state?.level ?? "OK";
  const crossing = shouldNotifyStockCrossing(prev, next);
  const generation = crossing ? (state?.generation ?? 0) + 1 : (state?.generation ?? 0);
  if (!state) {
    await tx.stockAlertState.create({
      data: {
        ...key,
        level: next,
        generation,
        lastNotifiedAt: crossing ? new Date() : null,
      },
    });
  } else if (prev !== next || crossing) {
    await tx.stockAlertState.update({
      where: { id: state.id },
      data: {
        level: next,
        generation,
        lastNotifiedAt: crossing ? new Date() : state.lastNotifiedAt,
      },
    });
  }
  if (!crossing) return null;
  return enqueueOutbox(tx, {
    tenantId: input.tenantId,
    type: "STOCK_ALERT",
    aggregateId: input.variantId,
    payload: {
      locationId: input.locationId,
      variantId: input.variantId,
      available,
      threshold,
      level: next,
      generation,
    },
    correlationId: `stock:${input.tenantId}:${input.locationId}:${input.variantId}:${next}:${generation}`,
  });
}

export async function rescanLowStock(tenantId: string) {
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId } });
  const threshold = settings?.lowStockThreshold ?? 5;
  const stock = await prisma.stock.findMany({
    where: { tenantId },
    select: { locationId: true, variantId: true, quantity: true, reservedQuantity: true },
  });
  let crossings = 0;
  for (const row of stock) {
    const available = Number(row.quantity) - Number(row.reservedQuantity ?? 0);
    const event = await prisma.$transaction(
      (tx) =>
        evaluateStockAlert(tx, {
          tenantId,
          locationId: row.locationId,
          variantId: row.variantId,
          available,
          threshold,
        }),
      { timeout: 15_000 },
    );
    if (event) crossings += 1;
  }
  return { threshold, scanned: stock.length, queued: crossings };
}
