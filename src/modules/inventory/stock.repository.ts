import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, InsufficientStockError, requireTenantId } from "../../lib/scope.js";
import { cursorWhere, decodeCursor, pageMeta, parseLimit } from "../../lib/cursor.js";
import type { RequestContext } from "../../types.js";

const LOW = 5;

function lineStatus(available: number) {
  if (available <= 0) return "OUT_OF_STOCK";
  if (available <= LOW) return "LOW";
  return "IN_STOCK";
}

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
    const qty = Number(row.quantity);
    const reserved = Number(row.reservedQuantity ?? 0);
    const available = qty - reserved;
    const cost = Number(row.variant.cost);
    const variantLabel = row.variant.attributes.map((a) => a.option.label).join(" / ");
    return {
      id: row.id,
      variantId: row.variantId,
      productId: row.variant.product.id,
      product: row.variant.product.name,
      sku: row.variant.sku,
      variant: variantLabel || row.variant.sku,
      locationId: row.locationId,
      location: row.location.name,
      available,
      reserved,
      inTransit: 0,
      cost,
      stockValue: Number((qty * cost).toFixed(2)),
      status: lineStatus(available),
      productStatus: row.variant.product.status,
    };
  },

  async list(ctx: RequestContext, query: {
    q?: string;
    locationId?: string;
    status?: string;
    lowStock?: boolean;
    outOfStock?: boolean;
  }) {
    const tenantId = requireTenantId(ctx);
    const allowed = await this.allowedLocationIds(ctx);
    const locationId = query.locationId;
    if (locationId) await this.assertLocation(ctx, locationId);
    const q = query.q?.trim();
    const rows = await prisma.stock.findMany({
      where: {
        tenantId,
        locationId: locationId ?? { in: [...allowed] },
        ...(q
          ? {
              OR: [
                { variant: { sku: { contains: q, mode: "insensitive" } } },
                { variant: { product: { name: { contains: q, mode: "insensitive" } } } },
                { variant: { product: { code: { contains: q, mode: "insensitive" } } } },
                { variant: { barcodes: { some: { code: q, active: true } } } },
              ],
            }
          : {}),
      },
      include: stockInclude,
      orderBy: { variant: { sku: "asc" } },
      take: 300,
    });
    let mapped = rows.map((r) => this.mapRow(r));
    if (query.outOfStock || query.status === "OUT_OF_STOCK") mapped = mapped.filter((r) => r.status === "OUT_OF_STOCK");
    else if (query.lowStock || query.status === "LOW") mapped = mapped.filter((r) => r.status === "LOW");
    else if (query.status === "IN_STOCK") mapped = mapped.filter((r) => r.status === "IN_STOCK");
    return mapped;
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

  async listMovements(
    ctx: RequestContext,
    query: { limit?: unknown; cursor?: unknown; locationId?: string; variantId?: string },
  ) {
    const tenantId = requireTenantId(ctx);
    const allowed = await this.allowedLocationIds(ctx);
    if (query.locationId) {
      if (!allowed.has(query.locationId)) throw new ForbiddenError();
    }
    const limit = parseLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const rows = await prisma.stockMovement.findMany({
      where: {
        tenantId,
        locationId: query.locationId ?? { in: [...allowed] },
        ...(query.variantId ? { variantId: query.variantId } : {}),
        ...cursorWhere(cursor),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return { rows, meta: pageMeta(rows, limit) };
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
    if (input.quantity <= 0) throw Object.assign(new Error("Quantity must be positive"), { code: "VALIDATION" });
    const delta = input.direction === "DECREASE" ? -input.quantity : input.quantity;
    return prisma.$transaction(async (tx) => {
      const existing = await tx.stock.findUnique({
        where: { tenantId_locationId_channel_variantId: { tenantId, locationId: input.locationId, channel: "STORE", variantId: input.variantId } },
      });
      const next = Number(existing?.quantity ?? 0) + delta;
      if (next < 0) throw new InsufficientStockError("Adjustment would make stock negative");
      const stock = existing
        ? await tx.stock.update({
            where: { id: existing.id },
            data: { quantity: String(next) },
          })
        : await tx.stock.create({
            data: {
              tenantId,
              locationId: input.locationId,
              variantId: input.variantId,
              quantity: String(next),
            },
          });
      const movement = await tx.stockMovement.create({
        data: {
          tenantId,
          locationId: input.locationId,
          variantId: input.variantId,
          type: "ADJUSTMENT",
          quantity: String(delta),
          reason: input.reason,
          notes: input.notes,
          createdById: ctx.userId,
        },
      });
      return { stock, movement };
    });
  },

  async transfer(
    ctx: RequestContext,
    input: { variantId: string; fromLocationId: string; toLocationId: string; quantity: number; notes?: string },
  ) {
    const tenantId = requireTenantId(ctx);
    await this.assertLocation(ctx, input.fromLocationId);
    await this.assertLocation(ctx, input.toLocationId);
    if (input.fromLocationId === input.toLocationId) {
      throw Object.assign(new Error("Locations must differ"), { code: "VALIDATION" });
    }
    if (input.quantity <= 0) throw Object.assign(new Error("Quantity must be positive"), { code: "VALIDATION" });
    return prisma.$transaction(async (tx) => {
      const from = await tx.stock.findUnique({
        where: {
          tenantId_locationId_channel_variantId: {
            tenantId,
            locationId: input.fromLocationId,
            channel: "STORE",
            variantId: input.variantId,
          },
        },
      });
      const available = Number(from?.quantity ?? 0) - Number(from?.reservedQuantity ?? 0);
      if (!from || available < input.quantity) throw new InsufficientStockError("Not enough available stock to transfer");
      await tx.stock.update({
        where: { id: from.id },
        data: { quantity: { decrement: input.quantity } },
      });
      await tx.stock.upsert({
        where: {
          tenantId_locationId_channel_variantId: {
            tenantId,
            locationId: input.toLocationId,
            channel: "STORE",
            variantId: input.variantId,
          },
        },
        create: {
          tenantId,
          locationId: input.toLocationId,
          variantId: input.variantId,
          quantity: String(input.quantity),
        },
        update: { quantity: { increment: input.quantity } },
      });
      const out = await tx.stockMovement.create({
        data: {
          tenantId,
          locationId: input.fromLocationId,
          variantId: input.variantId,
          type: "TRANSFER_OUT",
          quantity: String(-input.quantity),
          notes: input.notes,
          createdById: ctx.userId,
          referenceType: "TRANSFER",
        },
      });
      const inn = await tx.stockMovement.create({
        data: {
          tenantId,
          locationId: input.toLocationId,
          variantId: input.variantId,
          type: "TRANSFER_IN",
          quantity: String(input.quantity),
          notes: input.notes,
          createdById: ctx.userId,
          referenceType: "TRANSFER",
          referenceId: out.id,
        },
      });
      return { out, in: inn };
    });
  },

  async reserve(
    ctx: RequestContext,
    input: { variantId: string; locationId: string; quantity: number; release?: boolean },
  ) {
    const tenantId = requireTenantId(ctx);
    await this.assertLocation(ctx, input.locationId);
    if (input.quantity <= 0) throw Object.assign(new Error("Quantity must be positive"), { code: "VALIDATION" });
    const stock = await prisma.stock.findUnique({
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
    return prisma.stock.update({
      where: { id: stock.id },
      data: { reservedQuantity: String(next) },
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
        if (!stock) {
          await tx.stock.create({
            data: {
              tenantId,
              locationId: input.locationId,
              channel: "STORE",
              variantId: line.variantId,
              quantity: String(counted),
            },
          });
        } else {
          await tx.stock.update({
            where: { id: stock.id },
            data: { quantity: String(counted) },
          });
        }
        await tx.stockMovement.create({
          data: {
            tenantId,
            locationId: input.locationId,
            variantId: line.variantId,
            type: "ADJUSTMENT",
            quantity: String(variance),
            reason: "STOCK_TAKE",
            referenceType: "StockTake",
            referenceId: take.id,
            createdById: ctx.userId,
          },
        });
      }
      return tx.stockTake.findFirstOrThrow({ where: { id: take.id }, include: { lines: true } });
    });
  },
};
