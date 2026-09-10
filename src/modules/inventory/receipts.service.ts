import { Prisma, type ReceiptKind } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { nextDocNumberTx } from "../../lib/erp.js";
import { ForbiddenError, assertBranch, hasPermission, requireTenantId } from "../../lib/scope.js";
import { completeIdempotency, d, notFound, replayOrBegin, validation } from "../../lib/http-errors.js";
import { applyStockChange } from "./stock.engine.js";
import { stockRepository } from "./stock.repository.js";
import type { RequestContext } from "../../types.js";
import { acceptEnum, acceptId, createdAtRange, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";

type ReceiptLineIn = {
  variantId: string;
  qty: number;
  unitCost: number;
  batchLot?: string;
  expiryDate?: string;
  notes?: string;
};

const receiptInclude = {
  items: true,
  supplier: { select: { id: true, name: true } },
  purchase: { select: { id: true, invoiceNumber: true } },
  branch: { select: { id: true, name: true } },
} as const;

function canCreate(ctx: RequestContext) {
  return hasPermission(ctx, "inventory.receive.create") || hasPermission(ctx, "inventory.receive.approve") || hasPermission(ctx, "purchase.manage");
}

function canPost(ctx: RequestContext) {
  return hasPermission(ctx, "inventory.receive.approve") || hasPermission(ctx, "purchase.manage");
}

function isSystemReceipt(row: { saleReturnId?: string | null; purchaseId?: string | null; sourceRef?: string | null }) {
  if (row.saleReturnId) return true;
  if (row.purchaseId && row.sourceRef && row.sourceRef === row.purchaseId) return true;
  return false;
}

async function decorateReceipts<T extends { items: { variantId: string }[] }>(rows: T[]) {
  const ids = [...new Set(rows.flatMap((r) => r.items.map((i) => i.variantId)))];
  const variants = ids.length
    ? await prisma.productVariant.findMany({
        where: { id: { in: ids } },
        select: { id: true, sku: true, product: { select: { name: true } } },
      })
    : [];
  const map = new Map(variants.map((v) => [v.id, v]));
  return rows.map((row) => ({
    ...row,
    items: row.items.map((i) => {
      const v = map.get(i.variantId);
      return { ...i, sku: v?.sku ?? i.variantId, product: v?.product.name ?? "" };
    }),
  }));
}

async function totals(items: { qty: Prisma.Decimal; unitCost: Prisma.Decimal }[]) {
  return {
    totalQty: items.reduce((n, i) => n.plus(i.qty), d(0)),
    totalCost: items.reduce((n, i) => n.plus(i.qty.mul(i.unitCost)), d(0)),
  };
}

async function applyReceiptStock(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    receipt: {
      id: string;
      kind: ReceiptKind;
      locationId: string;
      fromLocationId: string | null;
      items: { variantId: string; qty: Prisma.Decimal; unitCost: Prisma.Decimal }[];
    };
    userId: string;
    reverse?: boolean;
  },
) {
  const sign = input.reverse ? -1 : 1;
  if (input.receipt.kind === "TRANSFER") {
    if (!input.receipt.fromLocationId) validation("Transfer receiving requires a source location");
    for (const item of input.receipt.items) {
      const qty = d(item.qty);
      await applyStockChange(tx, {
        tenantId: input.tenantId,
        locationId: input.receipt.fromLocationId,
        variantId: item.variantId,
        bucket: "AVAILABLE",
        delta: qty.negated().mul(sign),
        type: "TRANSFER_OUT",
        referenceType: "StockReceipt",
        referenceId: input.receipt.id,
        createdById: input.userId,
        unitCost: item.unitCost,
        allowNegative: false,
      });
      await applyStockChange(tx, {
        tenantId: input.tenantId,
        locationId: input.receipt.locationId,
        variantId: item.variantId,
        bucket: "AVAILABLE",
        delta: qty.mul(sign),
        type: "TRANSFER_IN",
        referenceType: "StockReceipt",
        referenceId: input.receipt.id,
        createdById: input.userId,
        unitCost: item.unitCost,
      });
    }
    return;
  }
  const type =
    input.receipt.kind === "OPENING"
      ? "OPENING"
      : input.receipt.kind === "CUSTOMER_RETURN"
        ? "SALE_RETURN"
        : input.receipt.kind === "ADJUSTMENT"
          ? "ADJUSTMENT"
          : "PURCHASE";
  for (const item of input.receipt.items) {
    await applyStockChange(tx, {
      tenantId: input.tenantId,
      locationId: input.receipt.locationId,
      variantId: item.variantId,
      bucket: "AVAILABLE",
      delta: d(item.qty).mul(sign),
      type,
      referenceType: "StockReceipt",
      referenceId: input.receipt.id,
      createdById: input.userId,
      unitCost: item.unitCost,
      reason: input.receipt.kind,
      allowNegative: Boolean(input.reverse),
    });
  }
}

export async function listReceipts(ctx: RequestContext, query: Record<string, unknown> = {}) {
  const tenantId = requireTenantId(ctx);
  if (!hasPermission(ctx, "inventory.receive.view") && !hasPermission(ctx, "purchase.view") && !hasPermission(ctx, "purchase.manage")) {
    throw new ForbiddenError();
  }
  const list = parseListQuery(query, { sortable: ["createdAt", "number", "status", "kind"], defaultSort: "createdAt", defaultOrder: "desc" });
  const status = acceptEnum(query.status, ["DRAFT", "RECEIVED", "CANCELLED"] as const);
  const kind = acceptEnum(query.kind, ["PURCHASE", "SUPPLIER", "OPENING", "CUSTOMER_RETURN", "ADJUSTMENT", "TRANSFER"] as const);
  const supplierId = acceptId(query.supplierId);
  const locationId = acceptId(query.locationId);
  const dates = createdAtRange(list);
  const q = list.search;
  const where = {
    tenantId,
    ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
    ...(status ? { status } : {}),
    ...(kind ? { kind } : {}),
    ...(supplierId ? { supplierId } : {}),
    ...(locationId ? { locationId } : {}),
    ...(dates ? { createdAt: dates } : {}),
    ...(q
      ? {
          OR: [{ number: ilike(q) }, { notes: ilike(q) }, { sourceRef: ilike(q) }, { supplier: { name: ilike(q) } }],
        }
      : {}),
  };
  return withPagination(list, {
    find: (skip, take) =>
      prisma.stockReceipt.findMany({
        where,
        select: {
          id: true,
          number: true,
          kind: true,
          status: true,
          totalQty: true,
          totalCost: true,
          createdAt: true,
          saleReturnId: true,
          purchaseId: true,
          sourceRef: true,
          supplier: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
        orderBy: list.sortBy === "number" || list.sortBy === "status" || list.sortBy === "kind" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.stockReceipt.count({ where }),
  });
}

export async function getReceipt(ctx: RequestContext, id: string) {
  const tenantId = requireTenantId(ctx);
  const row = await prisma.stockReceipt.findFirst({
    where: { id, tenantId },
    include: receiptInclude,
  });
  if (!row) notFound("Receiving document not found");
  assertBranch(ctx, row.branchId);
  return (await decorateReceipts([row]))[0];
}

export async function createReceipt(input: {
  ctx: RequestContext;
  branchId: string;
  locationId?: string;
  kind: ReceiptKind;
  supplierId?: string;
  purchaseId?: string;
  purchaseOrderId?: string;
  fromLocationId?: string;
  notes?: string;
  items: ReceiptLineIn[];
  post?: boolean;
  idempotencyKey?: string;
}) {
  const tenantId = requireTenantId(input.ctx);
  if (!canCreate(input.ctx)) throw new ForbiddenError("Receiving not permitted");
  if (!input.items.length) validation("Receiving items required");
  assertBranch(input.ctx, input.branchId);
  return prisma.$transaction(async (tx) => {
    const replay = await replayOrBegin(tx, {
      tenantId,
      key: input.idempotencyKey,
      method: "POST",
      path: "/inventory/receipts",
    });
    if (replay.replay) return replay.body as Awaited<ReturnType<typeof getReceipt>>;
    const branch = await tx.branch.findFirst({ where: { id: input.branchId, tenantId } });
    if (!branch) notFound("Branch not found");
    const locationId = input.locationId || branch.locationId;
    await stockRepository.assertLocation(input.ctx, locationId);
    if (input.fromLocationId) await stockRepository.assertLocation(input.ctx, input.fromLocationId);
    if (input.kind === "TRANSFER" && !input.fromLocationId) validation("fromLocationId required for transfer receiving");
    if ((input.kind === "PURCHASE" || input.kind === "SUPPLIER") && !input.supplierId && !input.purchaseId) {
      validation("Supplier or purchase is required for this receiving type");
    }
    const kinds: ReceiptKind[] = ["PURCHASE", "SUPPLIER", "OPENING", "CUSTOMER_RETURN", "ADJUSTMENT", "TRANSFER"];
    if (!kinds.includes(input.kind)) validation("Invalid receiving type");
    const ids = [...new Set(input.items.map((i) => i.variantId))];
    const owned = await tx.productVariant.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } });
    if (owned.length !== ids.length) throw new ForbiddenError("Variant not in tenant");
    const computed = input.items.map((i) => {
      const qty = d(i.qty);
      const unitCost = d(i.unitCost ?? 0);
      if (qty.lessThanOrEqualTo(0)) validation("Quantity must be positive");
      return {
        variantId: i.variantId,
        qty,
        unitCost,
        lineCost: qty.mul(unitCost),
        batchLot: i.batchLot,
        expiryDate: i.expiryDate ? new Date(i.expiryDate) : null,
        notes: i.notes,
      };
    });
    const { totalQty, totalCost } = await totals(computed);
    const postNow = Boolean(input.post) && canPost(input.ctx);
    const number = await nextDocNumberTx(tx, tenantId, input.branchId, "RCV", "RCV");
    const row = await tx.stockReceipt.create({
      data: {
        tenantId,
        branchId: input.branchId,
        locationId,
        number,
        kind: input.kind,
        status: postNow ? "RECEIVED" : "DRAFT",
        supplierId: input.supplierId,
        purchaseId: input.purchaseId,
        purchaseOrderId: input.purchaseOrderId,
        fromLocationId: input.fromLocationId,
        notes: input.notes,
        totalQty,
        totalCost,
        createdById: input.ctx.userId,
        receivedById: postNow ? input.ctx.userId : null,
        receivedAt: postNow ? new Date() : null,
        idempotencyKey: input.idempotencyKey,
        items: {
          create: computed.map((i) => ({
            variantId: i.variantId,
            qty: i.qty,
            unitCost: i.unitCost,
            lineCost: i.lineCost,
            batchLot: i.batchLot,
            expiryDate: i.expiryDate,
            notes: i.notes,
          })),
        },
      },
      include: receiptInclude,
    });
    if (postNow) {
      await applyReceiptStock(tx, {
        tenantId,
        receipt: { id: row.id, kind: row.kind, locationId: row.locationId, fromLocationId: row.fromLocationId, items: computed },
        userId: input.ctx.userId,
      });
    }
    const full = await tx.stockReceipt.findFirstOrThrow({ where: { id: row.id }, include: receiptInclude });
    await completeIdempotency(tx, { tenantId, key: input.idempotencyKey, status: 201, body: full });
    return full;
  }, { timeout: 20_000 });
}

export async function receiveReceipt(input: { ctx: RequestContext; id: string; idempotencyKey?: string }) {
  const tenantId = requireTenantId(input.ctx);
  if (!canPost(input.ctx)) throw new ForbiddenError("Receiving approval not permitted");
  return prisma.$transaction(async (tx) => {
    const replay = await replayOrBegin(tx, {
      tenantId,
      key: input.idempotencyKey,
      method: "POST",
      path: `/inventory/receipts/${input.id}/receive`,
    });
    if (replay.replay) return replay.body;
    await tx.$queryRaw`SELECT id FROM "StockReceipt" WHERE id = ${input.id} FOR UPDATE`;
    const row = await tx.stockReceipt.findFirst({
      where: { id: input.id, tenantId },
      include: { items: true },
    });
    if (!row) notFound("Receiving document not found");
    assertBranch(input.ctx, row.branchId);
    if (row.status === "RECEIVED") {
      const full = await tx.stockReceipt.findFirstOrThrow({ where: { id: row.id }, include: receiptInclude });
      await completeIdempotency(tx, { tenantId, key: input.idempotencyKey, status: 200, body: full });
      return full;
    }
    if (row.status === "CANCELLED") validation("Cancelled receiving cannot be posted");
    await applyReceiptStock(tx, {
      tenantId,
      receipt: row,
      userId: input.ctx.userId,
    });
    const updated = await tx.stockReceipt.update({
      where: { id: row.id },
      data: { status: "RECEIVED", receivedById: input.ctx.userId, receivedAt: new Date() },
      include: receiptInclude,
    });
    await tx.auditLog.create({
      data: {
        tenantId,
        userId: input.ctx.userId,
        actorUserId: input.ctx.userId,
        action: "inventory.receive.approve",
        entityType: "StockReceipt",
        entityId: row.id,
        after: { status: "RECEIVED" },
      },
    });
    await completeIdempotency(tx, { tenantId, key: input.idempotencyKey, status: 200, body: updated });
    return updated;
  }, { timeout: 20_000 });
}

export async function cancelReceipt(input: { ctx: RequestContext; id: string; reason?: string }) {
  const tenantId = requireTenantId(input.ctx);
  if (!canPost(input.ctx)) throw new ForbiddenError("Cancel not permitted");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "StockReceipt" WHERE id = ${input.id} FOR UPDATE`;
    const row = await tx.stockReceipt.findFirst({
      where: { id: input.id, tenantId },
      include: { items: true },
    });
    if (!row) notFound("Receiving document not found");
    assertBranch(input.ctx, row.branchId);
    if (row.status === "CANCELLED") return tx.stockReceipt.findFirstOrThrow({ where: { id: row.id }, include: receiptInclude });
    if (isSystemReceipt(row)) {
      validation("This receiving was posted by a purchase or customer return. Reverse it with a purchase return or inventory adjustment.");
    }
    if (row.status === "RECEIVED") {
      await applyReceiptStock(tx, {
        tenantId,
        receipt: row,
        userId: input.ctx.userId,
        reverse: true,
      });
    }
    return tx.stockReceipt.update({
      where: { id: row.id },
      data: {
        status: "CANCELLED",
        cancelledById: input.ctx.userId,
        cancelledAt: new Date(),
        cancelReason: input.reason,
      },
      include: receiptInclude,
    });
  }, { timeout: 20_000 });
}

export async function linkPurchaseReceipt(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    branchId: string;
    locationId: string;
    purchaseId: string;
    supplierId: string;
    userId: string;
    items: { variantId: string; qty: Prisma.Decimal; unitCost: Prisma.Decimal }[];
    notes?: string | null;
  },
) {
  const existing = await tx.stockReceipt.findFirst({
    where: { tenantId: input.tenantId, kind: "PURCHASE", sourceRef: input.purchaseId },
  });
  if (existing) return existing;
  const number = await nextDocNumberTx(tx, input.tenantId, input.branchId, "RCV", "RCV");
  const { totalQty, totalCost } = await totals(input.items);
  return tx.stockReceipt.create({
    data: {
      tenantId: input.tenantId,
      branchId: input.branchId,
      locationId: input.locationId,
      number,
      kind: "PURCHASE",
      status: "RECEIVED",
      supplierId: input.supplierId,
      purchaseId: input.purchaseId,
      sourceRef: input.purchaseId,
      notes: input.notes,
      totalQty,
      totalCost,
      createdById: input.userId,
      receivedById: input.userId,
      receivedAt: new Date(),
      items: {
        create: input.items.map((i) => ({
          variantId: i.variantId,
          qty: i.qty,
          unitCost: i.unitCost,
          lineCost: i.qty.mul(i.unitCost),
        })),
      },
    },
  });
}

export async function receiptsSummary(ctx: RequestContext, query: { from?: string; to?: string } = {}) {
  const tenantId = requireTenantId(ctx);
  if (!hasPermission(ctx, "inventory.receive.view") && !hasPermission(ctx, "purchase.view") && !hasPermission(ctx, "purchase.manage")) {
    throw new ForbiddenError();
  }
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : undefined;
  const where = {
    tenantId,
    status: "RECEIVED" as const,
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
  const agg = await prisma.stockReceipt.aggregate({
    where,
    _count: { _all: true },
    _sum: { totalQty: true, totalCost: true },
  });
  return {
    count: agg._count._all,
    receivedQty: Number(agg._sum?.totalQty ?? 0),
    receivedValue: Number(agg._sum?.totalCost ?? 0).toFixed(2),
  };
}
