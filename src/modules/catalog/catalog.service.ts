import { prisma } from "../../lib/prisma.js";
import { applyStockChange } from "../inventory/stock.engine.js";
import { buildVariantKey } from "../../shared/variant-key.js";
import { cartesian, DEFAULT_VARIANT_KEY, makeSku, randomBarcode, slugify } from "../../shared/cartesian.js";
import type { RequestContext } from "../../types.js";

export const productInclude = {
  taxCategory: true,
  categoryRef: true,
  subcategory: true,
  brand: true,
  unit: true,
  supplier: true,
  images: { orderBy: { sortOrder: "asc" as const } },
  bundleItems: { include: { variant: { include: { product: { select: { name: true, code: true } } } } } },
  variants: {
    include: {
      unit: true,
      attributes: { include: { option: { include: { definition: true } } } },
      barcodes: { where: { active: true } },
      stock: true,
      images: { orderBy: { sortOrder: "asc" as const } },
    },
  },
} as const;

/** Slim include for list/POS search — avoids loading bundle trees and unused relations. */
export const productListInclude = {
  taxCategory: { select: { id: true, name: true, rate: true } },
  categoryRef: { select: { id: true, name: true } },
  images: { where: { isPrimary: true }, take: 1, select: { url: true, isPrimary: true } },
  variants: {
    select: {
      id: true,
      sku: true,
      price: true,
      cost: true,
      status: true,
      imageUrl: true,
      attributes: {
        select: { option: { select: { value: true, label: true, definition: { select: { key: true } } } } },
      },
      barcodes: { where: { active: true }, select: { code: true, primary: true } },
      stock: { select: { locationId: true, quantity: true } },
    },
  },
} as const;

export type OpeningRow = {
  locationId: string;
  quantity?: string | number;
  unitCost?: string | number;
  reorderLevel?: string | number;
};

export type VariantInput = {
  optionIds?: string[];
  sku?: string;
  barcode?: string;
  barcodeKind?: string;
  price?: string | number;
  cost?: string | number;
  discount?: string | number;
  wholesalePrice?: string | number;
  retailPrice?: string | number;
  minStock?: string | number;
  weight?: string | number;
  imageUrl?: string;
  status?: string;
  unitId?: string;
  openingStock?: OpeningRow[];
};

type OptionRow = {
  id: string;
  value: string;
  label: string;
  definition: { id: string; key: string };
};

export async function assertUniqueSku(tenantId: string, sku: string, excludeVariantId?: string) {
  const hit = await prisma.productVariant.findFirst({
    where: { tenantId, sku: sku.toUpperCase(), ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}) },
  });
  if (hit) throw Object.assign(new Error("SKU already exists"), { code: "CONFLICT" });
}

export async function assertUniqueBarcode(tenantId: string, code: string, excludeBarcodeId?: string) {
  if (!code) return;
  const hit = await prisma.barcode.findFirst({
    where: { tenantId, code, active: true, ...(excludeBarcodeId ? { id: { not: excludeBarcodeId } } : {}) },
  });
  if (hit) throw Object.assign(new Error("Barcode already in use"), { code: "CONFLICT" });
}

export async function assertUniqueProductCode(tenantId: string, code: string, excludeProductId?: string) {
  const hit = await prisma.product.findFirst({
    where: { tenantId, code: code.toUpperCase(), ...(excludeProductId ? { id: { not: excludeProductId } } : {}) },
  });
  if (hit) throw Object.assign(new Error("Product code already exists"), { code: "CONFLICT" });
}

export async function applyOpeningStock(
  ctx: RequestContext,
  variantId: string,
  rows: OpeningRow[] | undefined,
  trackInventory: boolean,
) {
  if (!trackInventory || !Array.isArray(rows)) return;
  for (const row of rows) {
    if (!row.locationId) continue;
    const qty = Number(row.quantity ?? 0);
    const cost = Number(row.unitCost ?? 0);
    const reorder = Number(row.reorderLevel ?? 0);
    const existing = await prisma.stock.findUnique({
      where: {
        tenantId_locationId_channel_variantId: {
          tenantId: ctx.tenantId!,
          locationId: row.locationId,
          channel: "STORE",
          variantId,
        },
      },
    });
    const current = Number(existing?.quantity ?? 0);
    const delta = qty - current;
    if (delta !== 0) {
      await prisma.$transaction(async (tx) => {
        await applyStockChange(tx, {
          tenantId: ctx.tenantId!,
          locationId: row.locationId,
          variantId,
          bucket: "AVAILABLE",
          delta,
          type: "OPENING",
          createdById: ctx.userId,
          reason: "Opening stock",
          unitCost: cost,
          allowNegative: true,
        });
        await tx.stock.updateMany({
          where: {
            tenantId: ctx.tenantId!,
            locationId: row.locationId,
            variantId,
            channel: "STORE",
          },
          data: { reorderLevel: String(reorder), unitCost: String(cost) },
        });
      });
    } else if (existing) {
      await prisma.stock.update({
        where: { id: existing.id },
        data: { reorderLevel: String(reorder), unitCost: String(cost) },
      });
    } else {
      await prisma.stock.create({
        data: {
          tenantId: ctx.tenantId!,
          locationId: row.locationId,
          variantId,
          quantity: 0,
          unitCost: String(cost),
          reorderLevel: String(reorder),
        },
      });
    }
  }
}

async function loadOptions(optionIds: string[]) {
  if (!optionIds.length) return [] as OptionRow[];
  const options = await prisma.attributeOption.findMany({
    where: { id: { in: optionIds } },
    include: { definition: true },
  });
  const byId = new Map(options.map((o) => [o.id, o]));
  return optionIds.map((id) => byId.get(id)).filter(Boolean) as OptionRow[];
}

export async function createVariantRecord(
  ctx: RequestContext,
  product: { id: string; code: string; unitId: string | null; trackInventory: boolean },
  input: VariantInput,
) {
  const options = await loadOptions(input.optionIds ?? []);
  const variantKey = options.length
    ? buildVariantKey(options.map((o) => ({ key: o.definition.key, value: o.value })))
    : DEFAULT_VARIANT_KEY;
  const sku = String(input.sku || makeSku(product.code, options.map((o) => o.value))).toUpperCase();
  await assertUniqueSku(ctx.tenantId!, sku);
  const barcode = String(input.barcode || randomBarcode());
  await assertUniqueBarcode(ctx.tenantId!, barcode);

  const existing = await prisma.productVariant.findFirst({
    where: { productId: product.id, variantKey },
  });
  if (existing) return existing;

  const variant = await prisma.productVariant.create({
    data: {
      tenantId: ctx.tenantId!,
      productId: product.id,
      sku,
      variantKey,
      price: String(input.price ?? 0),
      cost: String(input.cost ?? 0),
      discount: String(input.discount ?? 0),
      wholesalePrice: input.wholesalePrice != null ? String(input.wholesalePrice) : null,
      retailPrice: input.retailPrice != null ? String(input.retailPrice) : null,
      minStock: String(input.minStock ?? 0),
      weight: input.weight != null && input.weight !== "" ? String(input.weight) : null,
      imageUrl: input.imageUrl || null,
      unitId: input.unitId || product.unitId,
      status: (input.status as "ACTIVE" | "INACTIVE") ?? "ACTIVE",
      attributes: options.length ? { create: options.map((o) => ({ optionId: o.id })) } : undefined,
      barcodes: {
        create: {
          tenantId: ctx.tenantId!,
          code: barcode,
          kind: input.barcodeKind ?? (barcode.length === 13 ? "EAN13" : "CODE128"),
          primary: true,
        },
      },
    },
  });
  await applyOpeningStock(ctx, variant.id, input.openingStock, product.trackInventory);
  return variant;
}

export async function generateFromAxes(
  ctx: RequestContext,
  product: { id: string; code: string; unitId: string | null; trackInventory: boolean },
  axes: { definitionId: string; optionIds: string[] }[],
  defaults: VariantInput,
  overrides: VariantInput[] = [],
) {
  const optionGroups: OptionRow[][] = [];
  for (const axis of axes) {
    if (!axis.optionIds?.length) continue;
    const opts = await loadOptions(axis.optionIds);
    if (opts.length) optionGroups.push(opts);
  }
  if (!optionGroups.length) return [];

  const combos = cartesian(optionGroups);
  const overrideMap = new Map<string, VariantInput>();
  for (const row of overrides) {
    const opts = await loadOptions(row.optionIds ?? []);
    const key = opts.length
      ? buildVariantKey(opts.map((o) => ({ key: o.definition.key, value: o.value })))
      : DEFAULT_VARIANT_KEY;
    overrideMap.set(key, row);
  }

  const created = [];
  for (const combo of combos) {
    const key = buildVariantKey(combo.map((o) => ({ key: o.definition.key, value: o.value })));
    const extra = overrideMap.get(key) ?? {};
    created.push(
      await createVariantRecord(ctx, product, {
        ...defaults,
        ...extra,
        optionIds: combo.map((o) => o.id),
        sku: extra.sku || defaults.sku || makeSku(product.code, combo.map((o) => o.value)),
        openingStock: extra.openingStock ?? defaults.openingStock,
      }),
    );
  }
  return created;
}

export function uniqueSlug(base: string, used: Set<string>) {
  let slug = slugify(base);
  let n = 2;
  while (used.has(slug)) {
    slug = `${slugify(base)}-${n}`;
    n += 1;
  }
  used.add(slug);
  return slug;
}

export { slugify };
