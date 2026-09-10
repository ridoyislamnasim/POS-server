import { Prisma, type DamageReason } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { nextDocNumberTx } from "../../lib/erp.js";
import { ForbiddenError, assertBranch, hasPermission, requireTenantId } from "../../lib/scope.js";
import { completeIdempotency, d, notFound, replayOrBegin, validation } from "../../lib/http-errors.js";
import { moveAvailableToDamaged, readBuckets } from "./stock.engine.js";
import { stockRepository } from "./stock.repository.js";
import { saveDataUrl } from "../../lib/uploads.js";
import type { RequestContext } from "../../types.js";
import { acceptEnum, acceptId, createdAtRange, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { enqueueOutbox } from "../outbox/enqueue.js";

type DamageLineIn = { variantId: string; qty: number; notes?: string };

const damageInclude = {
  items: true,
  branch: { select: { id: true, name: true } },
} as const;

function canCreate(ctx: RequestContext) {
  return hasPermission(ctx, "inventory.damage.create") || hasPermission(ctx, "inventory.damage.approve") || hasPermission(ctx, "inventory.adjust");
}

function canApprove(ctx: RequestContext) {
  return hasPermission(ctx, "inventory.damage.approve") || hasPermission(ctx, "inventory.adjust");
}

export async function listDamages(ctx: RequestContext, query: Record<string, unknown> = {}) {
  const tenantId = requireTenantId(ctx);
  if (!hasPermission(ctx, "inventory.damage.view") && !hasPermission(ctx, "inventory.adjust")) throw new ForbiddenError();
  const list = parseListQuery(query, { sortable: ["createdAt", "number", "status", "reason"], defaultSort: "createdAt", defaultOrder: "desc" });
  const status = acceptEnum(query.status, ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED", "STOCK_ADJUSTED"] as const);
  const reason = acceptEnum(query.reason, [
    "BROKEN",
    "EXPIRED",
    "DEFECTIVE",
    "SPOILED",
    "LOST",
    "THEFT",
    "HANDLING_DAMAGE",
    "CUSTOMER_RETURN_DAMAGE",
    "SUPPLIER_DAMAGE",
    "OTHER",
  ] as const);
  const locationId = acceptId(query.locationId);
  const dates = createdAtRange(list);
  const q = list.search;
  const where = {
    tenantId,
    ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
    ...(status ? { status } : {}),
    ...(reason ? { reason } : {}),
    ...(locationId ? { locationId } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(q ? { OR: [{ number: ilike(q) }, { description: ilike(q) }] } : {}),
  };
  return withPagination(list, {
    find: (skip, take) =>
      prisma.stockDamage.findMany({
        where,
        select: {
          id: true,
          number: true,
          status: true,
          reason: true,
          totalQty: true,
          totalCost: true,
          createdAt: true,
          description: true,
          branch: { select: { id: true, name: true } },
        },
        orderBy:
          list.sortBy === "number" || list.sortBy === "status" || list.sortBy === "reason"
            ? { [list.sortBy]: list.sortOrder }
            : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.stockDamage.count({ where }),
  });
}

export async function getDamage(ctx: RequestContext, id: string) {
  const tenantId = requireTenantId(ctx);
  const row = await prisma.stockDamage.findFirst({ where: { id, tenantId }, include: damageInclude });
  if (!row) notFound("Damage record not found");
  assertBranch(ctx, row.branchId);
  return row;
}

export async function createDamage(input: {
  ctx: RequestContext;
  branchId: string;
  locationId?: string;
  reason: DamageReason;
  description?: string;
  attachmentDataUrl?: string;
  items: DamageLineIn[];
  submit?: boolean;
  idempotencyKey?: string;
}) {
  const tenantId = requireTenantId(input.ctx);
  if (!canCreate(input.ctx)) throw new ForbiddenError("Damage reporting not permitted");
  if (!input.items.length) validation("Damage items required");
  assertBranch(input.ctx, input.branchId);
  const attachmentUrl = input.attachmentDataUrl ? await saveDataUrl(input.attachmentDataUrl) : null;
  return prisma.$transaction(async (tx) => {
    const replay = await replayOrBegin(tx, {
      tenantId,
      key: input.idempotencyKey,
      method: "POST",
      path: "/inventory/damages",
    });
    if (replay.replay) return replay.body;
    const branch = await tx.branch.findFirst({ where: { id: input.branchId, tenantId } });
    if (!branch) notFound("Branch not found");
    const locationId = input.locationId || branch.locationId;
    await stockRepository.assertLocation(input.ctx, locationId);
    const ids = [...new Set(input.items.map((i) => i.variantId))];
    const variants = await tx.productVariant.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true, sku: true, cost: true },
    });
    if (variants.length !== ids.length) throw new ForbiddenError("Variant not in tenant");
    const byId = new Map(variants.map((v) => [v.id, v]));
    const computed = input.items.map((i) => {
      const qty = d(i.qty);
      if (qty.lessThanOrEqualTo(0)) validation("Quantity must be positive");
      const v = byId.get(i.variantId)!;
      return {
        variantId: i.variantId,
        skuSnapshot: v.sku,
        qty,
        unitCost: v.cost,
        lineCost: qty.mul(v.cost),
        notes: i.notes,
      };
    });
    const totalQty = computed.reduce((n, i) => n.plus(i.qty), d(0));
    const totalCost = computed.reduce((n, i) => n.plus(i.lineCost), d(0));
    const number = await nextDocNumberTx(tx, tenantId, input.branchId, "DMG", "DMG");
    const submit = Boolean(input.submit);
    const row = await tx.stockDamage.create({
      data: {
        tenantId,
        branchId: input.branchId,
        locationId,
        number,
        status: submit ? "SUBMITTED" : "DRAFT",
        reason: input.reason,
        description: input.description,
        attachmentUrl,
        totalQty,
        totalCost,
        createdById: input.ctx.userId,
        submittedAt: submit ? new Date() : null,
        idempotencyKey: input.idempotencyKey,
        items: {
          create: computed.map((i) => ({
            variantId: i.variantId,
            skuSnapshot: i.skuSnapshot,
            qty: i.qty,
            unitCost: i.unitCost,
            lineCost: i.lineCost,
            notes: i.notes,
          })),
        },
      },
      include: damageInclude,
    });
    if (submit) {
      await enqueueOutbox(tx, {
        tenantId,
        type: "DAMAGE_SUBMITTED",
        aggregateId: row.id,
        payload: { branchId: input.branchId, number: row.number, message: `Damage ${row.number} submitted.`, entityType: "StockDamage", entityId: row.id },
      });
    }
    await completeIdempotency(tx, { tenantId, key: input.idempotencyKey, status: 201, body: row });
    return row;
  }, { timeout: 20_000 });
}

export async function submitDamage(input: { ctx: RequestContext; id: string }) {
  const tenantId = requireTenantId(input.ctx);
  if (!canCreate(input.ctx)) throw new ForbiddenError();
  const row = await prisma.stockDamage.findFirst({ where: { id: input.id, tenantId } });
  if (!row) notFound("Damage record not found");
  assertBranch(input.ctx, row.branchId);
  if (row.status !== "DRAFT") validation("Only draft damage can be submitted");
  const updated = await prisma.stockDamage.update({
    where: { id: row.id },
    data: { status: "SUBMITTED", submittedAt: new Date() },
    include: damageInclude,
  });
  await enqueueOutbox(prisma, {
    tenantId,
    type: "DAMAGE_SUBMITTED",
    aggregateId: updated.id,
    payload: { branchId: updated.branchId, number: updated.number, message: `Damage ${updated.number} submitted.`, entityType: "StockDamage", entityId: updated.id },
  });
  return updated;
}

export async function decideDamage(input: {
  ctx: RequestContext;
  id: string;
  approve: boolean;
  rejectReason?: string;
  idempotencyKey?: string;
}) {
  const tenantId = requireTenantId(input.ctx);
  if (!canApprove(input.ctx)) throw new ForbiddenError("Damage approval not permitted");
  return prisma.$transaction(async (tx) => {
    const replay = await replayOrBegin(tx, {
      tenantId,
      key: input.idempotencyKey,
      method: "POST",
      path: `/inventory/damages/${input.id}/${input.approve ? "approve" : "reject"}`,
    });
    if (replay.replay) return replay.body;
    await tx.$queryRaw`SELECT id FROM "StockDamage" WHERE id = ${input.id} FOR UPDATE`;
    const row = await tx.stockDamage.findFirst({
      where: { id: input.id, tenantId },
      include: { items: true, branch: true },
    });
    if (!row) notFound("Damage record not found");
    assertBranch(input.ctx, row.branchId);
    if (row.status === "STOCK_ADJUSTED" || row.status === "APPROVED") {
      const full = await tx.stockDamage.findFirstOrThrow({ where: { id: row.id }, include: damageInclude });
      await completeIdempotency(tx, { tenantId, key: input.idempotencyKey, status: 200, body: full });
      return full;
    }
    if (row.status === "REJECTED") validation("Damage already rejected");
    if (row.status === "DRAFT") validation("Submit the damage report before approval");
    if (!input.approve) {
      const updated = await tx.stockDamage.update({
        where: { id: row.id },
        data: {
          status: "REJECTED",
          rejectedById: input.ctx.userId,
          rejectedAt: new Date(),
          rejectReason: input.rejectReason,
        },
        include: damageInclude,
      });
      await enqueueOutbox(tx, {
        tenantId,
        type: "DAMAGE_DECIDED",
        aggregateId: row.id,
        payload: { approved: false, branchId: row.branchId, number: row.number, message: `Damage ${row.number} rejected.`, entityType: "StockDamage", entityId: row.id },
      });
      await completeIdempotency(tx, { tenantId, key: input.idempotencyKey, status: 200, body: updated });
      return updated;
    }

    const allowNegative = row.branch.negativeStockPolicy !== "BLOCK";
    const itemUpdates: { id: string; stockBefore: Prisma.Decimal; stockAfter: Prisma.Decimal }[] = [];
    for (const line of row.items) {
      const result = await moveAvailableToDamaged(tx, {
        tenantId,
        locationId: row.locationId,
        variantId: line.variantId,
        qty: line.qty,
        reason: row.reason,
        notes: row.description ?? undefined,
        referenceType: "StockDamage",
        referenceId: row.id,
        createdById: input.ctx.userId,
        allowNegative,
      });
      itemUpdates.push({
        id: line.id,
        stockBefore: result.available.before,
        stockAfter: result.available.after,
      });
    }
    for (const u of itemUpdates) {
      await tx.stockDamageItem.update({
        where: { id: u.id },
        data: { stockBefore: u.stockBefore, stockAfter: u.stockAfter },
      });
    }
    const updated = await tx.stockDamage.update({
      where: { id: row.id },
      data: {
        status: "STOCK_ADJUSTED",
        approvedById: input.ctx.userId,
        approvedAt: new Date(),
      },
      include: damageInclude,
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: input.ctx.userId,
        actorUserId: input.ctx.userId,
        action: "inventory.damage.approve",
        entityType: "StockDamage",
        entityId: row.id,
        after: { status: "STOCK_ADJUSTED" },
      },
    });
    await enqueueOutbox(tx, {
      tenantId,
      type: "DAMAGE_DECIDED",
      aggregateId: row.id,
      payload: { approved: true, branchId: row.branchId, number: row.number, message: `Damage ${row.number} approved.`, entityType: "StockDamage", entityId: row.id },
    });
    await completeIdempotency(tx, { tenantId, key: input.idempotencyKey, status: 200, body: updated });
    return updated;
  }, { timeout: 20_000 });
}

export async function damagesSummary(ctx: RequestContext, query: { from?: string; to?: string } = {}) {
  const tenantId = requireTenantId(ctx);
  if (!hasPermission(ctx, "inventory.damage.view") && !hasPermission(ctx, "inventory.adjust")) throw new ForbiddenError();
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
  const where = {
    tenantId,
    status: { in: ["STOCK_ADJUSTED", "APPROVED"] as Array<"STOCK_ADJUSTED" | "APPROVED"> },
    ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
    ...(from || to
      ? {
          createdAt: {
            ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}),
            ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}),
          },
        }
      : {}),
  };
  const [agg, total] = await Promise.all([
    prisma.stockDamage.aggregate({
      where,
      _count: { _all: true },
      _sum: { totalQty: true, totalCost: true },
    }),
    prisma.stockDamage.count({
      where: {
        tenantId,
        ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
      },
    }),
  ]);
  return {
    count: total,
    adjusted: agg._count._all,
    damagedQty: Number(agg._sum?.totalQty ?? 0),
    damageCost: Number(agg._sum?.totalCost ?? 0).toFixed(2),
  };
}

export function currentStockSnapshot(row: {
  quantity: Prisma.Decimal;
  reservedQuantity: Prisma.Decimal;
  damagedQuantity: Prisma.Decimal;
  quarantineQuantity: Prisma.Decimal;
}) {
  return readBuckets(row);
}
