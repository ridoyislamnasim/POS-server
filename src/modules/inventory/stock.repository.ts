import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, InsufficientStockError, requireTenantId } from "../../lib/scope.js";
import { acceptEnum, acceptId, createdAtRange, parseListQuery, withPagination } from "../../lib/list-query.js";
import { applyStockChange, mapStockTotals } from "./stock.engine.js";
import { evaluateStockAlert } from "../notifications/stock-alert.js";
import type { RequestContext } from "../../types.js";

const LOW = 5;

const stockInclude = {
  variant: {
    include: {
      product: { select: { id: true, name: true, code: true, category: true, status: true } },
      attributes: { include: { option: { include: { definition: true } } } },
      barcodes: { where: { active: true } },
    },
  },
  location: { select: { id: true, name: true, type: true } },
} as const;

export const stockRepository = {
  async allowedLocationIds(ctx: RequestContext) {
    const tenantId = requireTenantId(ctx);
    const branches = await prisma.branch.findMany({
      where: {
        tenantId,
        ...(ctx.allBranches || ctx.isPlatform ? {} : { id: { in: ctx.branchIds } }),
      },
      select: { locationId: true },
    });
    return new Set(branches.map((b) => b.locationId));
  },

  async assertLocation(ctx: RequestContext, locationId: string) {
    const allowed = await this.allowedLocationIds(ctx);
    if (!allowed.has(locationId)) throw new ForbiddenError();
  },

  async assertVariant(ctx: RequestContext, variantId: string) {
    const tenantId = requireTenantId(ctx);
    const row = await prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      select: { id: true },
    });
    if (!row) throw new ForbiddenError("Variant not in tenant");
  },

  async listLocations(ctx: RequestContext) {
    const tenantId = requireTenantId(ctx);
    const allowed = await this.allowedLocationIds(ctx);
    return prisma.location.findMany({
      where: { tenantId, id: { in: [...allowed] } },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    });
  },

  async listByLocation(ctx: RequestContext, locationId: string) {
    const tenantId = requireTenantId(ctx);
    await this.assertLocation(ctx, locationId);
    return prisma.stock.findMany({
      where: { tenantId, locationId },
      include: { variant: { include: { product: true } } },
    });
  },

  mapRow(row: {
    id: string;
    quantity: Prisma.Decimal;
    reservedQuantity?: Prisma.Decimal | null;
    damagedQuantity?: Prisma.Decimal | null;
    quarantineQuantity?: Prisma.Decimal | null;
    reorderLevel?: Prisma.Decimal | null;
    unitCost?: Prisma.Decimal | null;
    variantId: string;
    locationId: string;
    variant: {
      sku: string;
      price: Prisma.Decimal;
      cost: Prisma.Decimal;
      status: string;
      product: { id: string; name: string; code: string; category: string | null; status: string };
      attributes: { option: { label: string; definition: { key: string } } }[];
    };
    location: { id: string; name: string; type: string };
  }) {
    const totals = mapStockTotals({
      quantity: row.quantity,
      reservedQuantity: row.reservedQuantity,
      damagedQuantity: row.damagedQuantity,
      quarantineQuantity: row.quarantineQuantity,
      unitCost: row.variant.cost,
    });
    const variantLabel = row.variant.attributes.map((a) => a.option.label).join(" / ");
    const reorder = Number(row.reorderLevel ?? 0);
    const status = totals.available <= 0 ? "OUT_OF_STOCK" : totals.available <= (reorder || LOW) ? "LOW" : "IN_STOCK";
    return {
      id: row.id,
      variantId: row.variantId,
      productId: row.variant.product.id,
      product: row.variant.product.name,
      sku: row.variant.sku,
      variant: variantLabel || row.variant.sku,
      locationId: row.locationId,
      location: row.location.name,
      available: totals.available,
      reserved: totals.reserved,
      damaged: totals.damaged,
      quarantine: totals.quarantine,
      physical: totals.physical,
      inTransit: 0,
      cost: totals.unitCost,
      stockValue: totals.availableValue,
      damagedValue: totals.damagedValue,
      status,
      reorderLevel: reorder,
      productStatus: row.variant.product.status,
    };
  },

  async list(ctx: RequestContext, query: Record<string, unknown>) {
    const tenantId = requireTenantId(ctx);
    const allowed = await this.allowedLocationIds(ctx);
    const list = parseListQuery(query, { sortable: ["sku", "product", "available"], defaultSort: "sku", defaultOrder: "asc" });
    const locationId = acceptId(query.locationId);
    if (locationId) await this.assertLocation(ctx, locationId);
    const locIds = locationId ? [locationId] : [...allowed];
    if (!locIds.length) return { rows: [], pagination: { page: list.page, limit: list.limit, total: 0, totalPages: 1 } };
    const q = list.search;
    const status = acceptEnum(query.status, ["IN_STOCK", "LOW", "OUT_OF_STOCK"] as const)
      ?? (query.outOfStock === "1" || query.outOfStock === true ? "OUT_OF_STOCK" : query.lowStock === "1" || query.lowStock === true ? "LOW" : undefined);

    const searchSql = q
      ? Prisma.sql`AND (
          v.sku ILIKE ${"%" + q + "%"}
          OR p.name ILIKE ${"%" + q + "%"}
          OR p.code ILIKE ${"%" + q + "%"}
          OR EXISTS (SELECT 1 FROM "Barcode" b WHERE b."variantId" = v.id AND b.active = true AND b.code ILIKE ${"%" + q + "%"})
        )`
      : Prisma.empty;
    const statusSql =
      status === "OUT_OF_STOCK"
        ? Prisma.sql`AND (s.quantity - s."reservedQuantity") <= 0`
        : status === "LOW"
          ? Prisma.sql`AND (s.quantity - s."reservedQuantity") > 0 AND (s.quantity - s."reservedQuantity") <= GREATEST(s."reorderLevel", 5)`
          : status === "IN_STOCK"
            ? Prisma.sql`AND (s.quantity - s."reservedQuantity") > GREATEST(s."reorderLevel", 5)`
            : Prisma.empty;
    const locSql = Prisma.sql`AND s."locationId" IN (${Prisma.join(locIds)})`;

    const [{ count }] = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*)::bigint AS count
      FROM "Stock" s
      JOIN "ProductVariant" v ON v.id = s."variantId"
      JOIN "Product" p ON p.id = v."productId"
      WHERE s."tenantId" = ${tenantId}
      ${locSql}
      ${searchSql}
      ${statusSql}
    `;
    const idRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id
      FROM "Stock" s
      JOIN "ProductVariant" v ON v.id = s."variantId"
      JOIN "Product" p ON p.id = v."productId"
      WHERE s."tenantId" = ${tenantId}
      ${locSql}
      ${searchSql}
      ${statusSql}
      ORDER BY v.sku ASC
      LIMIT ${list.take} OFFSET ${list.skip}
    `;
    const ids = idRows.map((r) => r.id);
    const rows = ids.length
      ? await prisma.stock.findMany({
          where: { tenantId, id: { in: ids } },
          include: stockInclude,
        })
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const mapped = ids.map((id) => byId.get(id)).filter(Boolean).map((r) => this.mapRow(r!));
    return { rows: mapped, pagination: { page: list.page, limit: list.limit, total: Number(count), totalPages: Math.max(1, Math.ceil(Number(count) / list.limit) || 1) } };
  },

  async getVariant(ctx: RequestContext, variantId: string) {
    const tenantId = requireTenantId(ctx);
    const allowed = await this.allowedLocationIds(ctx);
    const variant = await prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      include: {
        product: true,
        attributes: { include: { option: { include: { definition: true } } } },
        barcodes: { where: { active: true } },
        stock: { where: { locationId: { in: [...allowed] } }, include: { location: true } },
      },
    });
    if (!variant) throw new ForbiddenError();
    const movements = await prisma.stockMovement.findMany({
      where: { tenantId, variantId, locationId: { in: [...allowed] } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return {
      variant,
      stock: variant.stock.map((s) =>
        this.mapRow({
          id: s.id,
          quantity: s.quantity,
          reservedQuantity: s.reservedQuantity,
          damagedQuantity: s.damagedQuantity,
          quarantineQuantity: s.quarantineQuantity,
          variantId: s.variantId,
          locationId: s.locationId,
          variant: {
            sku: variant.sku,
            price: variant.price,
            cost: variant.cost,
            status: variant.status,
            product: variant.product,
            attributes: variant.attributes,
          },
          location: s.location,
        }),
      ),
      movements,
    };
  },

  async listMovements(ctx: RequestContext, query: Record<string, unknown>) {
    const tenantId = requireTenantId(ctx);
    const allowed = await this.allowedLocationIds(ctx);
    const locationId = acceptId(query.locationId);
    if (locationId && !allowed.has(locationId)) throw new ForbiddenError();
    const variantId = acceptId(query.variantId);
    const type = acceptEnum(
      query.type,
      ["OPENING", "SALE", "SALE_RETURN", "PURCHASE", "PURCHASE_RETURN", "TRANSFER_OUT", "TRANSFER_IN", "ADJUSTMENT", "DAMAGE", "SHRINKAGE", "QUARANTINE"] as const,
    );
    const list = parseListQuery(query, { sortable: ["createdAt", "type", "quantity"], defaultSort: "createdAt", defaultOrder: "desc" });
    const dates = createdAtRange(list);
    const q = list.search;
    const where = {
      tenantId,
      locationId: locationId ?? { in: [...allowed] },
      ...(variantId ? { variantId } : {}),
      ...(type ? { type } : {}),
      ...(dates ? { createdAt: dates } : {}),
      ...(q
        ? {
            OR: [
              { reason: { contains: q, mode: "insensitive" as const } },
              { notes: { contains: q, mode: "insensitive" as const } },
              { referenceId: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const page = await withPagination(list, {
      find: (skip, take) =>
        prisma.stockMovement.findMany({
          where,
          select: {
            id: true,
            type: true,
            bucket: true,
            quantity: true,
            beforeQuantity: true,
            afterQuantity: true,
            unitCost: true,
            value: true,
            reason: true,
            notes: true,
            locationId: true,
            variantId: true,
            referenceType: true,
            referenceId: true,
            createdById: true,
            createdAt: true,
          },
          orderBy: list.sortBy === "type" || list.sortBy === "quantity" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
          skip,
          take,
        }),
      count: () => prisma.stockMovement.count({ where }),
    });
    const variantIds = [...new Set(page.rows.map((r) => r.variantId))];
    const locationIds = [...new Set(page.rows.map((r) => r.locationId))];
    const userIds = [...new Set(page.rows.map((r) => r.createdById).filter(Boolean))] as string[];
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
    return {
      rows: page.rows.map((r) => {
        const v = variantMap.get(r.variantId);
        return {
          ...r,
          sku: v?.sku ?? r.variantId,
          product: v?.product.name ?? "",
          location: locMap.get(r.locationId) ?? r.locationId,
          user: r.createdById ? userMap.get(r.createdById) ?? r.createdById : null,
        };
      }),
      pagination: page.pagination,
    };
  },

  async adjust(
    ctx: RequestContext,
    input: {
      variantId: string;
      locationId: string;
      direction: "INCREASE" | "DECREASE";
      quantity: number;
      reason: string;
      notes?: string;
    },
  ) {
    const tenantId = requireTenantId(ctx);
    await this.assertLocation(ctx, input.locationId);
    await this.assertVariant(ctx, input.variantId);
    if (input.quantity <= 0) throw Object.assign(new Error("Quantity must be positive"), { code: "VALIDATION" });
    const delta = input.direction === "DECREASE" ? -input.quantity : input.quantity;
    return prisma.$transaction(async (tx) => {
      const result = await applyStockChange(tx, {
        tenantId,
        locationId: input.locationId,
        variantId: input.variantId,
        bucket: "AVAILABLE",
        delta,
        type: "ADJUSTMENT",
        reason: input.reason,
        notes: input.notes,
        createdById: ctx.userId,
        referenceType: "Adjustment",
      });
      return { stock: result.stock, movement: result.movement };
    });
  },

  async transfer(
    ctx: RequestContext,
    input: { variantId: string; fromLocationId: string; toLocationId: string; quantity: number; notes?: string },
  ) {
    const tenantId = requireTenantId(ctx);
    await this.assertLocation(ctx, input.fromLocationId);
    await this.assertLocation(ctx, input.toLocationId);
    await this.assertVariant(ctx, input.variantId);
    if (input.fromLocationId === input.toLocationId) {
      throw Object.assign(new Error("Locations must differ"), { code: "VALIDATION" });
    }
    if (input.quantity <= 0) throw Object.assign(new Error("Quantity must be positive"), { code: "VALIDATION" });
    return prisma.$transaction(async (tx) => {
      const out = await applyStockChange(tx, {
        tenantId,
        locationId: input.fromLocationId,
        variantId: input.variantId,
        bucket: "AVAILABLE",
        delta: -input.quantity,
        type: "TRANSFER_OUT",
        notes: input.notes,
        createdById: ctx.userId,
        referenceType: "TRANSFER",
      });
      const inn = await applyStockChange(tx, {
        tenantId,
        locationId: input.toLocationId,
        variantId: input.variantId,
        bucket: "AVAILABLE",
        delta: input.quantity,
        type: "TRANSFER_IN",
        notes: input.notes,
        createdById: ctx.userId,
        referenceType: "TRANSFER",
        referenceId: out.movement.id,
        unitCost: out.stock.unitCost,
      });
      return { out: out.movement, in: inn.movement };
    });
  },

  async reserve(
    ctx: RequestContext,
    input: { variantId: string; locationId: string; quantity: number; release?: boolean },
  ) {
    const tenantId = requireTenantId(ctx);
    await this.assertLocation(ctx, input.locationId);
    await this.assertVariant(ctx, input.variantId);
    if (input.quantity <= 0) throw Object.assign(new Error("Quantity must be positive"), { code: "VALIDATION" });
    return prisma.$transaction(async (tx) => {
      const stock = await tx.stock.findUnique({
        where: {
          tenantId_locationId_channel_variantId: { tenantId, locationId: input.locationId, channel: "STORE", variantId: input.variantId },
        },
      });
      if (!stock) throw new ForbiddenError("Stock row not found");
      const reserved = Number(stock.reservedQuantity ?? 0);
      const next = input.release ? reserved - input.quantity : reserved + input.quantity;
      if (next < 0) throw Object.assign(new Error("Nothing to release"), { code: "VALIDATION" });
      if (!input.release && next > Number(stock.quantity)) {
        throw new InsufficientStockError("Not enough available stock to reserve");
      }
      const updated = await tx.stock.update({
        where: { id: stock.id },
        data: { reservedQuantity: String(next) },
      });
      await evaluateStockAlert(tx, {
        tenantId,
        locationId: input.locationId,
        variantId: input.variantId,
        available: Number(updated.quantity) - Number(updated.reservedQuantity ?? 0),
      });
      return updated;
    });
  },

  async listStockTakes(ctx: RequestContext) {
    const tenantId = requireTenantId(ctx);
    return prisma.stockTake.findMany({
      where: {
        tenantId,
        ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
      },
      include: { lines: true, branch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  },

  async postStockTake(
    ctx: RequestContext,
    input: { branchId: string; locationId: string; notes?: string; lines: { variantId: string; countedQty: number }[] },
  ) {
    const tenantId = requireTenantId(ctx);
    await this.assertLocation(ctx, input.locationId);
    for (const line of input.lines) {
      await this.assertVariant(ctx, line.variantId);
    }
    return prisma.$transaction(async (tx) => {
      const take = await tx.stockTake.create({
        data: {
          tenantId,
          branchId: input.branchId,
          locationId: input.locationId,
          status: "POSTED",
          notes: input.notes,
          createdById: ctx.userId,
          postedById: ctx.userId,
          postedAt: new Date(),
        },
      });
      for (const line of input.lines) {
        const stock = await tx.stock.findUnique({
          where: {
            tenantId_locationId_channel_variantId: {
              tenantId,
              locationId: input.locationId,
              channel: "STORE",
              variantId: line.variantId,
            },
          },
        });
        const systemQty = Number(stock?.quantity ?? 0);
        const counted = line.countedQty;
        const variance = counted - systemQty;
        await tx.stockTakeLine.create({
          data: {
            stockTakeId: take.id,
            variantId: line.variantId,
            systemQty: String(systemQty),
            countedQty: String(counted),
            variance: String(variance),
          },
        });
        if (variance === 0) continue;
        await applyStockChange(tx, {
          tenantId,
          locationId: input.locationId,
          variantId: line.variantId,
          bucket: "AVAILABLE",
          delta: variance,
          type: "ADJUSTMENT",
          reason: "STOCK_TAKE",
          referenceType: "StockTake",
          referenceId: take.id,
          createdById: ctx.userId,
          allowNegative: true,
        });
      }
      return tx.stockTake.findFirstOrThrow({ where: { id: take.id }, include: { lines: true } });
    });
  },
};
