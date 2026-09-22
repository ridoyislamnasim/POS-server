import { writeAudit } from "../../lib/audit.js";
import { acceptEnum, acceptId, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { deleteUpload, saveDataUrl } from "../../lib/uploads.js";
import { hasPermission } from "../../lib/scope.js";
import { IndustryPackRegistry } from "../../packs/registry.js";
import { DEFAULT_VARIANT_KEY } from "../../shared/cartesian.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import {
  applyOpeningStock,
  assertUniqueBarcode,
  assertUniqueProductCode,
  assertUniqueSku,
  createVariantRecord,
  generateFromAxes,
  slugify,
  type OpeningRow,
  type VariantInput,
} from "./catalog.service.js";
import { catalogRepository } from "./catalog.repository.js";

type Ctx = RequestContext;
type Body = Record<string, unknown>;

function trackingFromFlags(body: Body) {
  if (body.serialTracking) return "SERIAL" as const;
  if (body.batchTracking) return "BATCH" as const;
  if (body.expiryTracking) return "EXPIRY" as const;
  return "NONE" as const;
}

function calcFinalSellingPrice(retailPrice: unknown, discount: unknown): string {
  const retail = Number(retailPrice ?? 0);
  const disc = Number(discount ?? 0);
  return retail > 0 ? (retail - (retail * disc / 100)).toFixed(2) : "0";
}

function calcProfitMargin(retailPrice: unknown, discount: unknown, purchasePrice: unknown): string {
  const retail = Number(retailPrice ?? 0);
  const disc = Number(discount ?? 0);
  const cost = Number(purchasePrice ?? 0);
  const finalSelling = retail > 0 ? retail - (retail * disc / 100) : 0;
  const profit = finalSelling - cost;
  return finalSelling > 0 ? ((profit / finalSelling) * 100).toFixed(1) : "0";
}

function productPayload(body: Body, extra: { category?: string | null } = {}) {
  const type = String(body.type ?? "SIMPLE").toUpperCase();
  const mapped = type === "PHYSICAL" ? "SIMPLE" : type;
  const discountStr = body.discount != null && body.discount !== "" ? String(body.discount) : "0";
  const retailStr = body.retailPrice != null && body.retailPrice !== "" ? String(body.retailPrice) : "";
  return {
    name: body.name ? String(body.name) : undefined,
    code: body.code ? String(body.code).toUpperCase() : undefined,
    type: mapped as "SIMPLE" | "VARIABLE" | "SERVICE" | "DIGITAL" | "SUBSCRIPTION" | "BUNDLE" | "PHYSICAL",
    status: body.status ? (String(body.status).toUpperCase() as "ACTIVE" | "INACTIVE" | "DRAFT" | "ARCHIVED") : undefined,
    categoryId: body.categoryId === "" || body.categoryId === undefined ? undefined : String(body.categoryId),
    subcategoryId: body.subcategoryId === "" || body.subcategoryId === undefined ? null : String(body.subcategoryId),
    brandId: body.brandId === "" || body.brandId === undefined ? null : String(body.brandId),
    unitId: body.unitId === "" || body.unitId === undefined ? null : String(body.unitId),
    supplierId: body.supplierId === "" || body.supplierId === undefined ? null : String(body.supplierId),
    taxCategoryId: body.taxCategoryId === "" || body.taxCategoryId === undefined ? null : String(body.taxCategoryId),
    description: body.description != null ? String(body.description) : undefined,
    tags: body.tags != null ? String(body.tags) : undefined,
    barcode: body.barcode != null ? String(body.barcode) : undefined,
    featured: body.featured != null ? Boolean(body.featured) : undefined,
    posSaleEnabled: body.posSaleEnabled != null ? Boolean(body.posSaleEnabled) : undefined,
    onlineSaleEnabled: body.onlineSaleEnabled != null ? Boolean(body.onlineSaleEnabled) : undefined,
    trackInventory: body.trackInventory != null ? Boolean(body.trackInventory) : undefined,
    allowNegativeStock: body.allowNegativeStock != null ? Boolean(body.allowNegativeStock) : undefined,
    expiryTracking: body.expiryTracking != null ? Boolean(body.expiryTracking) : undefined,
    batchTracking: body.batchTracking != null ? Boolean(body.batchTracking) : undefined,
    serialTracking: body.serialTracking != null ? Boolean(body.serialTracking) : undefined,
    sellingPrice: retailStr ? calcFinalSellingPrice(body.retailPrice, body.discount) : undefined,
    purchasePrice: body.purchasePrice != null && body.purchasePrice !== "" ? String(body.purchasePrice) : undefined,
    wholesalePrice: body.wholesalePrice != null && body.wholesalePrice !== "" ? String(body.wholesalePrice) : undefined,
    retailPrice: retailStr || undefined,
    discount: discountStr,
    profitMargin: retailStr ? calcProfitMargin(body.retailPrice, body.discount, body.purchasePrice) : undefined,
    minStock: body.minStock != null && body.minStock !== "" ? String(body.minStock) : undefined,
    reorderLevel: body.reorderLevel != null && body.reorderLevel !== "" ? String(body.reorderLevel) : undefined,
    ...extra,
  };
}

async function assertVariantsInTenant(tenantId: string, variantIds: string[]) {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (!ids.length) return;
  const n = await catalogRepository.countVariantsInTenant(tenantId, ids);
  if (n !== ids.length) throw new AppError("FORBIDDEN", "Variant not in tenant", 403);
}

function redactProducts<T extends { purchasePrice?: unknown; wholesalePrice?: unknown; profitMargin?: unknown; variants: { cost?: unknown }[] }>(
  ctx: Ctx,
  products: T[],
) {
  if (hasPermission(ctx, "catalog.manage") || hasPermission(ctx, "purchase.view")) return products;
  return products.map((p) => ({
    ...p,
    purchasePrice: null,
    wholesalePrice: null,
    profitMargin: null,
    variants: p.variants.map((v) => ({ ...v, cost: null })),
  }));
}

/**
 * Product/variant/barcode business logic. No Express `req`/`res` here.
 */
export const catalogProductsService = {
  async upload(dataUrl: string) {
    if (!dataUrl) throw new AppError("VALIDATION", "dataUrl required", 400);
    return { url: await saveDataUrl(String(dataUrl)) };
  },

  async deleteUpload(url: string) {
    if (!url) throw new AppError("VALIDATION", "url required", 400);
    await deleteUpload(url);
    return { deleted: true };
  },

  async listProducts(ctx: Ctx, query: Record<string, unknown>) {
    const posOnly = query.pos === "1" || query.pos === "true";
    const list = parseListQuery(query, {
      sortable: ["name", "code", "createdAt", "status"],
      defaultSort: "name",
      defaultOrder: "asc",
      defaultLimit: posOnly ? 50 : 25,
    });
    const statusRaw = String(query.status ?? (posOnly ? "ACTIVE" : "ALL")).toUpperCase();
    const status = statusRaw === "ALL" ? undefined : acceptEnum(statusRaw, ["ACTIVE", "ARCHIVED", "DRAFT", "INACTIVE", "DISCONTINUED"] as const);
    const categoryId = acceptId(query.categoryId);
    const supplierId = acceptId(query.supplierId);
    const q = list.search;
    const where = {
      tenantId: ctx.tenantId!,
      ...(status ? { status } : {}),
      ...(posOnly ? { posSaleEnabled: true } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(supplierId ? { supplierId } : {}),
      ...(q
        ? {
            OR: [
              { name: ilike(q) },
              { code: ilike(q) },
              { barcode: ilike(q) },
              { variants: { some: { sku: ilike(q) } } },
              { variants: { some: { barcodes: { some: { code: { contains: q, mode: "insensitive" as const }, active: true } } } } },
            ],
          }
        : {}),
    };
    const { rows, pagination } = await withPagination(list, {
      find: (skip, take) =>
        catalogRepository.listProducts({ where, skip, take, orderBy: { [list.sortBy]: list.sortOrder } }),
      count: () => catalogRepository.countProducts(where),
    });
    const data = rows.map((p) => ({
      ...p,
      category: p.categoryRef?.name ?? p.category,
      variants: statusRaw === "ALL" ? p.variants : p.variants.filter((v) => v.status === "ACTIVE"),
    }));
    return { rows: redactProducts(ctx, data), pagination };
  },

  async listVariants(ctx: Ctx, query: Record<string, unknown>) {
    const list = parseListQuery(query, { sortable: ["sku", "createdAt"], defaultSort: "sku", defaultOrder: "asc" });
    const q = list.search;
    const where = {
      tenantId: ctx.tenantId!,
      status: "ACTIVE" as const,
      ...(q
        ? {
            OR: [
              { sku: ilike(q) },
              { product: { name: ilike(q) } },
              { product: { code: ilike(q) } },
              { barcodes: { some: { code: { contains: q, mode: "insensitive" as const }, active: true } } },
            ],
          }
        : {}),
    };
    const { rows, pagination } = await withPagination(list, {
      find: (skip, take) => catalogRepository.listVariants({ where, skip, take, order: list.sortOrder }),
      count: () => catalogRepository.countVariants(where),
    });
    const canCost = hasPermission(ctx, "catalog.manage") || hasPermission(ctx, "purchase.view");
    return {
      rows: rows.map((v) => ({
        id: v.id,
        sku: v.sku,
        price: v.price,
        cost: canCost ? v.cost : null,
        status: v.status,
        name: v.product.name,
        productId: v.product.id,
        code: v.product.code,
      })),
      pagination,
    };
  },

  async lookupBarcode(ctx: Ctx, code: string) {
    const barcode = await catalogRepository.findBarcode(ctx.tenantId!, code);
    if (barcode) return barcode;
    const bySku = await catalogRepository.findVariantBySku(ctx.tenantId!, code.toUpperCase());
    if (!bySku) throw new AppError("NOT_FOUND", "Barcode not found", 404);
    return { code, variant: bySku, primary: true, kind: "SKU" };
  },

  async matrix(ctx: Ctx, productId: string) {
    const product = await catalogRepository.findProductDetail(ctx.tenantId!, productId);
    if (!product) throw new AppError("NOT_FOUND", "Product not found", 404);
    const tenant = await catalogRepository.findTenant(ctx.tenantId!);
    const axes = IndustryPackRegistry.matrixAxes(tenant?.industryPack ?? "FASHION");
    const defs = [...new Set(product.variants.flatMap((v) => v.attributes.map((a) => a.option.definition)))];
    const rowKey = defs.some((d) => d.key === axes.row) ? axes.row : defs[0]?.key;
    const colKey = defs.some((d) => d.key === axes.col && d.key !== rowKey) ? axes.col : defs.find((d) => d.key !== rowKey)?.key;
    const rows = new Map<string, string>();
    const cols = new Map<string, string>();
    const cells: Record<string, (typeof product.variants)[0]> = {};
    for (const v of product.variants) {
      const row = rowKey ? v.attributes.find((a) => a.option.definition.key === rowKey) : undefined;
      const col = colKey ? v.attributes.find((a) => a.option.definition.key === colKey) : undefined;
      if (row) rows.set(row.option.value, row.option.label);
      if (col) cols.set(col.option.value, col.option.label);
      if (row && col) cells[`${row.option.value}|${col.option.value}`] = v;
    }
    return {
      product,
      axes: { row: rowKey, col: colKey },
      rows: [...rows.entries()].map(([value, label]) => ({ value, label })),
      cols: [...cols.entries()].map(([value, label]) => ({ value, label })),
      colours: [...rows.entries()].map(([value, label]) => ({ value, label })),
      sizes: [...cols.entries()].map(([value, label]) => ({ value, label })),
      cells,
    };
  },

  async getProduct(ctx: Ctx, productId: string) {
    const product = await catalogRepository.findProductDetail(ctx.tenantId!, productId);
    if (!product) throw new AppError("NOT_FOUND", "Product not found", 404);
    return redactProducts(ctx, [product])[0];
  },

  async createProduct(ctx: Ctx, body: Body, correlationId?: string) {
    const name = String(body.name ?? "").trim();
    const code = String(body.code ?? "").trim().toUpperCase();
    const categoryId = String(body.categoryId ?? "");
    if (!name || !code) throw new AppError("VALIDATION", "name and code required", 400);
    if (!categoryId) throw new AppError("VALIDATION", "category is required", 400);
    // VARIABLE products carry pricing on each variant — main-level prices are optional.
    const reqType = String(body.type ?? "SIMPLE").toUpperCase();
    const reqIsVariable = reqType === "VARIABLE";
    if (!reqIsVariable) {
      if (!body.purchasePrice || Number(body.purchasePrice) < 0) throw new AppError("VALIDATION", "Purchase / Cost Price is required", 400);
      if (!body.wholesalePrice || Number(body.wholesalePrice) < 0) throw new AppError("VALIDATION", "Wholesale Price is required", 400);
      if (!body.retailPrice || Number(body.retailPrice) < 0) throw new AppError("VALIDATION", "Retail Price is required", 400);
    }
    const cat = await catalogRepository.findCategory(ctx.tenantId!, categoryId);
    if (!cat) throw new AppError("VALIDATION", "Category not found", 400);
    if (body.subcategoryId) {
      const sub = await catalogRepository.findSubcategoryInCategory(
        ctx.tenantId!,
        String(body.subcategoryId),
        categoryId,
      );
      if (!sub) throw new AppError("VALIDATION", "Subcategory does not belong to the selected category", 400);
    }
    await assertUniqueProductCode(ctx.tenantId!, code);
    if (body.barcode) await assertUniqueBarcode(ctx.tenantId!, String(body.barcode));
    const type = String(body.type ?? "SIMPLE").toUpperCase();
    const mappedType = type === "PHYSICAL" ? "SIMPLE" : type;
    const trackInventory =
      body.trackInventory != null ? Boolean(body.trackInventory) : mappedType !== "SERVICE" && mappedType !== "DIGITAL";
    const product = await catalogRepository.createProduct({
      tenantId: ctx.tenantId!,
      name,
      code,
      category: cat.name,
      categoryId,
      subcategoryId: body.subcategoryId ? String(body.subcategoryId) : null,
      brandId: body.brandId ? String(body.brandId) : null,
      unitId: body.unitId ? String(body.unitId) : null,
      supplierId: body.supplierId ? String(body.supplierId) : null,
      taxCategoryId: body.taxCategoryId ? String(body.taxCategoryId) : null,
      type: mappedType as "SIMPLE" | "VARIABLE" | "SERVICE" | "DIGITAL" | "SUBSCRIPTION" | "BUNDLE",
      status: (String(body.status ?? "ACTIVE").toUpperCase() as "ACTIVE" | "INACTIVE" | "DRAFT") || "ACTIVE",
      description: body.description ? String(body.description) : null,
      tags: body.tags ? String(body.tags) : null,
      barcode: body.barcode ? String(body.barcode) : null,
      featured: Boolean(body.featured),
      posSaleEnabled: body.posSaleEnabled !== false,
      onlineSaleEnabled: Boolean(body.onlineSaleEnabled),
      trackInventory,
      allowNegativeStock: Boolean(body.allowNegativeStock),
      expiryTracking: Boolean(body.expiryTracking),
      batchTracking: Boolean(body.batchTracking),
      serialTracking: Boolean(body.serialTracking),
      sellingPrice: calcFinalSellingPrice(body.retailPrice, body.discount),
      purchasePrice: body.purchasePrice != null && body.purchasePrice !== "" ? String(body.purchasePrice) : null,
      wholesalePrice: body.wholesalePrice != null && body.wholesalePrice !== "" ? String(body.wholesalePrice) : null,
      retailPrice: body.retailPrice != null && body.retailPrice !== "" ? String(body.retailPrice) : null,
      discount: String(body.discount ?? 0),
      profitMargin: body.profitMargin != null && body.profitMargin !== "" ? String(body.profitMargin) : null,
      minStock: String(body.minStock ?? 0),
      reorderLevel: String(body.reorderLevel ?? 0),
    });

    const images = Array.isArray(body.images)
      ? (body.images as { url: string; isPrimary?: boolean; sortOrder?: number; alt?: string }[])
      : [];
    for (const [i, img] of images.entries()) {
      if (!img.url) continue;
      await catalogRepository.createImage({
        productId: product.id,
        url: img.url,
        alt: img.alt,
        isPrimary: Boolean(img.isPrimary) || i === 0,
        sortOrder: img.sortOrder ?? i,
      });
    }

    const defaults: VariantInput = {
      price: calcFinalSellingPrice(body.retailPrice, body.discount),
      cost: String((body.purchasePrice as string | undefined) || (body.cost as string | undefined) || 0),
      discount: String(body.discount ?? 0),
      wholesalePrice: body.wholesalePrice != null && body.wholesalePrice !== "" ? String(body.wholesalePrice) : undefined,
      retailPrice: body.retailPrice != null && body.retailPrice !== "" ? String(body.retailPrice) : undefined,
      minStock: String(body.minStock ?? 0),
      sku: body.code as string,
      barcode: body.barcode as string | undefined,
      openingStock: body.openingStock as VariantInput["openingStock"],
      unitId: body.unitId as string | undefined,
    };

    const axes = Array.isArray(body.axes) ? (body.axes as { definitionId: string; optionIds: string[] }[]) : [];
    const variantRows = Array.isArray(body.variants) ? (body.variants as VariantInput[]) : [];
    const isVariable = mappedType === "VARIABLE" || axes.some((a) => a.optionIds?.length);

    if (isVariable && axes.length) {
      await generateFromAxes(
        ctx,
        { id: product.id, code: product.code, unitId: product.unitId, trackInventory },
        axes,
        defaults,
        variantRows,
      );
      await catalogRepository.updateProductType(product.id, "VARIABLE");
    } else if (mappedType !== "BUNDLE") {
      const simple = (body.simple as VariantInput | undefined) ?? defaults;
      await createVariantRecord(
        ctx,
        { id: product.id, code: product.code, unitId: product.unitId, trackInventory },
        { ...simple, optionIds: [], sku: simple.sku || product.code, barcode: simple.barcode || String(body.barcode || "") },
      );
    }

    if (mappedType === "BUNDLE" && Array.isArray(body.bundleItems)) {
      const bundleItems = body.bundleItems as { variantId: string; qty: string | number }[];
      await assertVariantsInTenant(
        ctx.tenantId!,
        bundleItems.map((b) => b.variantId),
      );
      await catalogRepository.createBundleItems(
        bundleItems.map((b) => ({ bundleProductId: product.id, variantId: b.variantId, qty: String(b.qty ?? 1) })),
      );
      await createVariantRecord(
        ctx,
        { id: product.id, code: product.code, unitId: product.unitId, trackInventory: false },
        { ...defaults, optionIds: [], sku: product.code, barcode: String(body.barcode || "") },
      );
    }

    const tracking = trackingFromFlags(body);
    if (tracking !== "NONE") {
      await catalogRepository.setVariantTracking(product.id, tracking);
    }

    await writeAudit({
      ctx,
      action: "catalog.create",
      entityType: "Product",
      entityId: product.id,
      after: { name, code },
      correlationId,
    });
    return catalogRepository.findProductDetail(ctx.tenantId!, product.id);
  },

  async updateProduct(ctx: Ctx, productId: string, body: Body) {
    const existing = await catalogRepository.findProduct(ctx.tenantId!, productId);
    if (!existing) throw new AppError("NOT_FOUND", "Product not found", 404);
    if (body.code) await assertUniqueProductCode(ctx.tenantId!, String(body.code), existing.id);
    const categoryId = body.categoryId != null ? String(body.categoryId) : existing.categoryId;
    if (body.categoryId && !categoryId) throw new AppError("VALIDATION", "category is required", 400);
    const categoryRow = categoryId ? await catalogRepository.categoryName(categoryId, ctx.tenantId!) : null;
    const category = categoryRow?.name;
    if (body.subcategoryId && categoryId) {
      const sub = await catalogRepository.findSubcategoryInCategory(ctx.tenantId!, String(body.subcategoryId), categoryId);
      if (!sub) throw new AppError("VALIDATION", "Subcategory does not belong to the selected category", 400);
    }
    if (body.purchasePrice != null && body.purchasePrice !== "" && Number(body.purchasePrice) < 0) throw new AppError("VALIDATION", "Purchase / Cost Price is required", 400);
    if (body.wholesalePrice != null && body.wholesalePrice !== "" && Number(body.wholesalePrice) < 0) throw new AppError("VALIDATION", "Wholesale Price is required", 400);
    if (body.retailPrice != null && body.retailPrice !== "" && Number(body.retailPrice) < 0) throw new AppError("VALIDATION", "Retail Price is required", 400);
    const data = productPayload(body, { category: category ?? existing.category });
    const product = await catalogRepository.updateProduct(existing.id, {
      ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
    });
    if (Array.isArray(body.images)) {
      const imgs = (body.images as { url: string; isPrimary?: boolean; alt?: string }[]).map((img, i) => ({
        url: img.url,
        alt: img.alt,
        isPrimary: Boolean(img.isPrimary) || i === 0,
        sortOrder: i,
      }));
      await catalogRepository.replaceProductImages(existing.id, imgs);
    }
    const simple = body.simple as VariantInput | undefined;
    if (simple && product.type !== "VARIABLE") {
      const def = product.variants.find((v) => v.variantKey === DEFAULT_VARIANT_KEY) ?? product.variants[0];
      if (def) {
        await catalogRepository.updateVariant(def.id, {
          ...(simple.sku ? { sku: String(simple.sku).toUpperCase() } : {}),
          ...(simple.price != null ? { price: String(simple.price) } : {}),
          ...(simple.cost != null ? { cost: String(simple.cost) } : {}),
          ...(simple.discount != null ? { discount: String(simple.discount) } : {}),
          ...(simple.minStock != null ? { minStock: String(simple.minStock) } : {}),
          ...(simple.status ? { status: simple.status as "ACTIVE" | "INACTIVE" } : {}),
        });
        if (simple.barcode) {
          await assertUniqueBarcode(ctx.tenantId!, String(simple.barcode));
          await catalogRepository.demoteAllVariantBarcodes(def.id);
          await catalogRepository.createBarcode({
            tenantId: ctx.tenantId!,
            variantId: def.id,
            code: String(simple.barcode),
            kind: "CODE128",
            primary: true,
          });
        }
        if (Array.isArray((simple as any).openingStock)) {
          await applyOpeningStock(ctx, def.id, (simple as any).openingStock as OpeningRow[], product.trackInventory);
        }
      }
    }
    if (Array.isArray(body.bundleItems)) {
      const rows = (body.bundleItems as { variantId: string; qty: string | number }[]).filter((b) => b.variantId);
      await assertVariantsInTenant(
        ctx.tenantId!,
        rows.map((b) => b.variantId),
      );
      await catalogRepository.replaceBundleItems(
        existing.id,
        rows.map((b) => ({ bundleProductId: existing.id, variantId: b.variantId, qty: String(b.qty ?? 1) })),
      );
    }
    if (Array.isArray(body.variants) && product.type === "VARIABLE") {
      type VariantRowInput = VariantInput & { id?: string };
      const rows = body.variants as VariantRowInput[];
      const saved = await catalogRepository.listProductVariants(ctx.tenantId!, existing.id);
      const byId = new Map(saved.map((v) => [v.id, v]));
      for (const row of rows) {
        const status = String(row.status ?? "ACTIVE").toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE";
        if (row.id && byId.has(row.id)) {
          const cur = byId.get(row.id)!;
          const nextSku = row.sku ? String(row.sku).toUpperCase() : cur.sku;
          if (nextSku !== cur.sku) await assertUniqueSku(ctx.tenantId!, nextSku, cur.id);
          await catalogRepository.updateVariant(cur.id, {
            sku: nextSku,
            ...(row.price !== undefined ? { price: String(row.price) } : {}),
            ...(row.cost !== undefined ? { cost: String(row.cost) } : {}),
            ...(row.wholesalePrice !== undefined ? { wholesalePrice: row.wholesalePrice === "" || row.wholesalePrice == null ? null : String(row.wholesalePrice) } : {}),
            ...(row.retailPrice !== undefined ? { retailPrice: row.retailPrice === "" || row.retailPrice == null ? null : String(row.retailPrice) } : {}),
            ...(row.discount !== undefined ? { discount: String(row.discount) } : {}),
            ...(row.minStock !== undefined ? { minStock: String(row.minStock) } : {}),
            ...(row.weight !== undefined ? { weight: row.weight === "" || row.weight == null ? null : String(row.weight) } : {}),
            ...(row.imageUrl !== undefined ? { imageUrl: row.imageUrl || null } : {}),
            status,
          });
          if (row.imageUrl !== undefined && (cur as any).imageUrl && String(row.imageUrl || "") !== String((cur as any).imageUrl || "")) {
            await deleteUpload((cur as any).imageUrl);
          }
          if (Array.isArray((row as any).openingStock)) {
            await applyOpeningStock(ctx, cur.id, (row as any).openingStock as OpeningRow[], product.trackInventory);
          }
          const newCode = row.barcode != null ? String(row.barcode).trim() : "";
          const primary = cur.barcodes.find((b) => b.primary) ?? cur.barcodes[0];
          if (newCode && (!primary || primary.code !== newCode)) {
            await assertUniqueBarcode(ctx.tenantId!, newCode, primary?.id);
            if (primary) {
              await catalogRepository.updateBarcode(primary.id, { code: newCode, primary: true });
            } else {
              await catalogRepository.createBarcode({
                tenantId: ctx.tenantId!,
                variantId: cur.id,
                code: newCode,
                kind: "CODE128",
                primary: true,
              });
            }
          }
        } else if (row.optionIds?.length) {
          const rec = await createVariantRecord(
            ctx,
            { id: existing.id, code: product.code, unitId: product.unitId, trackInventory: product.trackInventory },
            { ...(row as VariantInput), status, openingStock: Array.isArray(row.openingStock) ? row.openingStock : [] },
          );
          await catalogRepository.updateVariant(rec.id, {
            ...(row.price !== undefined ? { price: String(row.price) } : {}),
            ...(row.cost !== undefined ? { cost: String(row.cost) } : {}),
            ...(row.discount !== undefined ? { discount: String(row.discount) } : {}),
            ...(row.minStock !== undefined ? { minStock: String(row.minStock) } : {}),
            ...(row.weight !== undefined ? { weight: row.weight === "" || row.weight == null ? null : String(row.weight) } : {}),
            ...(row.imageUrl !== undefined ? { imageUrl: row.imageUrl || null } : {}),
            status,
          });
        }
      }
      if (Array.isArray(body.removedVariantIds)) {
        const ids = (body.removedVariantIds as unknown[]).filter(
          (x): x is string => typeof x === "string" && byId.has(x),
        );
        for (const id of ids) {
          const doomed = byId.get(id) as any;
          if (doomed?.imageUrl) await deleteUpload(doomed.imageUrl);
          await catalogRepository.deleteVariantCascade(id);
        }
      }
    }
    return catalogRepository.findProductDetail(ctx.tenantId!, existing.id);
  },

  async archiveProduct(ctx: Ctx, productId: string, correlationId?: string) {
    const existing = await catalogRepository.findProduct(ctx.tenantId!, productId);
    if (!existing) throw new AppError("NOT_FOUND", "Product not found", 404);
    const product = await catalogRepository.archiveProduct(existing.id);
    await writeAudit({
      ctx,
      action: "catalog.archive",
      entityType: "Product",
      entityId: product.id,
      correlationId,
    });
    return product;
  },

  async generateVariants(ctx: Ctx, productId: string, body: Body) {
    const product = await catalogRepository.findProduct(ctx.tenantId!, productId);
    if (!product) throw new AppError("NOT_FOUND", "Product not found", 404);
    let axes = Array.isArray(body.axes) ? (body.axes as { definitionId: string; optionIds: string[] }[]) : [];
    if (!axes.length && Array.isArray(body.colourOptionIds) && Array.isArray(body.sizeOptionIds)) {
      const colour = await catalogRepository.findAttributeByKey(ctx.tenantId!, "colour");
      const size = await catalogRepository.findAttributeByKey(ctx.tenantId!, "size");
      axes = [
        { definitionId: colour?.id ?? "colour", optionIds: body.colourOptionIds as string[] },
        { definitionId: size?.id ?? "size", optionIds: body.sizeOptionIds as string[] },
      ];
    }
    if (!axes.length || axes.every((a) => !a.optionIds?.length)) {
      throw new AppError("VALIDATION", "Select at least one variant attribute with values", 400);
    }
    const defaults = await catalogRepository.findDefaultVariants(product.id);
    const defaultIds = defaults.map((d) => d.id);
    if (defaultIds.length) {
      await catalogRepository.deleteVariantsCascade(defaultIds);
    }
    const created = await generateFromAxes(
      ctx,
      { id: product.id, code: product.code, unitId: product.unitId, trackInventory: product.trackInventory },
      axes,
      {
        price: body.price as string | number | undefined,
        cost: body.cost as string | number | undefined,
        discount: body.discount as string | number | undefined,
        openingStock: body.openingStock as VariantInput["openingStock"],
      },
      Array.isArray(body.variants) ? (body.variants as VariantInput[]) : [],
    );
    await catalogRepository.updateProductType(product.id, "VARIABLE");
    const full = await catalogRepository.findProductDetail(ctx.tenantId!, product.id);
    return { product: full, created: created.length };
  },

  async patchVariant(ctx: Ctx, variantId: string, body: Body) {
    const existing = await catalogRepository.findVariant(ctx.tenantId!, variantId);
    if (!existing) throw new AppError("NOT_FOUND", "Variant not found", 404);
    const { sku, price, cost, status, discount, minStock, weight, imageUrl, wholesalePrice, retailPrice, unitId } = body;
    if (sku) {
      const hit = await catalogRepository.findVariantSku(ctx.tenantId!, String(sku).toUpperCase(), existing.id);
      if (hit) throw new AppError("CONFLICT", "SKU already exists", 409);
    }
    if (imageUrl !== undefined && (existing as any).imageUrl && String(imageUrl || "") !== String((existing as any).imageUrl || "")) {
      await deleteUpload((existing as any).imageUrl);
    }
    return catalogRepository.updateVariant(existing.id, {
      ...(sku ? { sku: String(sku).toUpperCase() } : {}),
      ...(price !== undefined ? { price: String(price) } : {}),
      ...(cost !== undefined ? { cost: String(cost) } : {}),
      ...(discount !== undefined ? { discount: String(discount) } : {}),
      ...(minStock !== undefined ? { minStock: String(minStock) } : {}),
      ...(weight !== undefined ? { weight: weight === "" ? null : String(weight) } : {}),
      ...(imageUrl !== undefined ? { imageUrl: imageUrl || null } : {}),
      ...(wholesalePrice !== undefined ? { wholesalePrice: wholesalePrice === "" ? null : String(wholesalePrice) } : {}),
      ...(retailPrice !== undefined ? { retailPrice: retailPrice === "" ? null : String(retailPrice) } : {}),
      ...(unitId !== undefined ? { unitId: unitId || null } : {}),
      ...(status ? { status } : {}),
    });
  },

  async deleteVariant(ctx: Ctx, variantId: string) {
    const existing = await catalogRepository.findVariant(ctx.tenantId!, variantId);
    if (!existing) throw new AppError("NOT_FOUND", "Variant not found", 404);
    if ((existing as any).imageUrl) await deleteUpload((existing as any).imageUrl);
    await catalogRepository.deleteVariantCascade(existing.id);
    return { id: existing.id };
  },

  async addBarcode(ctx: Ctx, variantId: string, body: { code: string; kind?: string; primary?: boolean }) {
    const existing = await catalogRepository.findVariant(ctx.tenantId!, variantId);
    if (!existing) throw new AppError("NOT_FOUND", "Variant not found", 404);
    if (!body.code) throw new AppError("VALIDATION", "code required", 400);
    try {
      await assertUniqueBarcode(ctx.tenantId!, String(body.code));
      if (body.primary) {
        await catalogRepository.demoteVariantBarcodes(ctx.tenantId!, existing.id);
      }
      return await catalogRepository.createBarcode({
        tenantId: ctx.tenantId!,
        variantId: existing.id,
        code: String(body.code),
        kind: body.kind ?? "CODE128",
        primary: Boolean(body.primary),
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError("CONFLICT", "Barcode already in use", 409);
    }
  },
};
