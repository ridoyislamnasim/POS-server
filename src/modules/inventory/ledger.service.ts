import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, hasPermission, requireTenantId } from "../../lib/scope.js";
import { cursorWhere, decodeCursor, pageMeta, parseLimit } from "../../lib/cursor.js";
import { mapStockTotals } from "./stock.engine.js";
import { stockRepository } from "./stock.repository.js";
import type { RequestContext } from "../../types.js";

export async function listLedger(
  ctx: RequestContext,
  query: {
    limit?: unknown;
    cursor?: unknown;
    locationId?: string;
    variantId?: string;
    type?: string;
    bucket?: string;
    referenceType?: string;
    from?: string;
    to?: string;
    q?: string;
  },
) {
  const tenantId = requireTenantId(ctx);
  if (!hasPermission(ctx, "inventory.ledger.view")) {
    throw new ForbiddenError();
  }
  const allowed = await stockRepository.allowedLocationIds(ctx);
  if (query.locationId && !allowed.has(query.locationId)) throw new ForbiddenError();
  const limit = parseLimit(query.limit);
  const cursor = decodeCursor(query.cursor);
  const rows = await prisma.stockMovement.findMany({
    where: {
      tenantId,
      locationId: query.locationId ?? { in: [...allowed] },
      ...(query.variantId ? { variantId: query.variantId } : {}),
      ...(query.type ? { type: query.type as never } : {}),
      ...(query.bucket ? { bucket: query.bucket as never } : {}),
      ...(query.referenceType ? { referenceType: query.referenceType } : {}),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...cursorWhere(cursor),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  const variantIds = [...new Set(rows.map((r) => r.variantId))];
  const locationIds = [...new Set(rows.map((r) => r.locationId))];
  const userIds = [...new Set(rows.map((r) => r.createdById).filter(Boolean))] as string[];
  const [variants, locations, users] = await Promise.all([
    variantIds.length
      ? prisma.productVariant.findMany({
          where: { id: { in: variantIds } },
          include: { product: { select: { name: true, code: true } } },
        })
      : [],
    locationIds.length ? prisma.location.findMany({ where: { id: { in: locationIds } }, select: { id: true, name: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
  ]);
  const variantMap = new Map(variants.map((v) => [v.id, v]));
  const locMap = new Map(locations.map((l) => [l.id, l.name]));
  const userMap = new Map(users.map((u) => [u.id, u.name]));
  const mapped = rows.map((r) => {
    const v = variantMap.get(r.variantId);
    return {
      ...r,
      sku: v?.sku ?? r.variantId,
      product: v?.product.name ?? "",
      location: locMap.get(r.locationId) ?? r.locationId,
      user: r.createdById ? userMap.get(r.createdById) ?? r.createdById : null,
    };
  });
  return { rows: mapped, meta: pageMeta(rows, limit) };
}

export async function stockSummary(ctx: RequestContext, locationId?: string) {
  const tenantId = requireTenantId(ctx);
  const allowed = await stockRepository.allowedLocationIds(ctx);
  if (locationId && !allowed.has(locationId)) throw new ForbiddenError();
  const rows = await prisma.stock.findMany({
    where: { tenantId, locationId: locationId ?? { in: [...allowed] } },
    include: { variant: { select: { cost: true } } },
  });
  let available = 0;
  let reserved = 0;
  let damaged = 0;
  let quarantine = 0;
  let physical = 0;
  let availableValue = 0;
  let damagedValue = 0;
  for (const row of rows) {
    const t = mapStockTotals({ ...row, unitCost: row.variant.cost });
    available += t.available;
    reserved += t.reserved;
    damaged += t.damaged;
    quarantine += t.quarantine;
    physical += t.physical;
    availableValue += t.availableValue;
    damagedValue += t.damagedValue;
  }
  return {
    available,
    reserved,
    damaged,
    quarantine,
    physical,
    availableValue: availableValue.toFixed(2),
    damagedValue: damagedValue.toFixed(2),
  };
}

export function movementValue(row: { quantity: string | number; value?: string | number | null; unitCost?: string | number | null }) {
  if (row.value != null && row.value !== "") return Number(row.value);
  return Math.abs(Number(row.quantity)) * Number(row.unitCost ?? 0);
}
