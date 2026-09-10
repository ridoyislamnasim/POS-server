import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok, okList } from "../../lib/envelope.js";
import { acceptEnum, acceptId, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { saveDataUrl } from "../../lib/uploads.js";
import { IndustryPackRegistry } from "../../packs/registry.js";
import { DEFAULT_VARIANT_KEY } from "../../shared/cartesian.js";
import type { AuthedRequest } from "../../types.js";
import { hasPermission } from "../../lib/scope.js";
import {
  assertUniqueBarcode,
  assertUniqueProductCode,
  createVariantRecord,
  generateFromAxes,
  productInclude,
  productListInclude,
  slugify,
  type VariantInput,
} from "./catalog.service.js";

export const catalogRouter = Router();
catalogRouter.use(requireAuth, requireTenant);

function handleErr(res: Parameters<typeof fail>[0], e: unknown) {
  const err = e as Error & { code?: string };
  if (err.code === "CONFLICT" || err.code === "P2002") return fail(res, "CONFLICT", err.message || "Already exists", 409);
  if (err.code === "FORBIDDEN") return fail(res, "FORBIDDEN", err.message || "Forbidden", 403);
  return fail(res, err.code === "VALIDATION" ? "VALIDATION" : "VALIDATION", err.message);
}

const manage = requirePermission("catalog.manage");

async function categoryName(categoryId?: string | null, tenantId?: string) {
  if (!categoryId) return null;
  const row = await prisma.category.findFirst({
    where: { id: categoryId, ...(tenantId ? { tenantId } : {}) },
  });
  return row?.name ?? null;
}

async function assertVariantsInTenant(tenantId: string, variantIds: string[]) {
  const ids = [...new Set(variantIds.filter(Boolean))];
  if (!ids.length) return;
  const n = await prisma.productVariant.count({ where: { tenantId, id: { in: ids } } });
  if (n !== ids.length) throw Object.assign(new Error("Variant not in tenant"), { code: "FORBIDDEN" });
}

function redactProducts<T extends { purchasePrice?: unknown; wholesalePrice?: unknown; profitMargin?: unknown; variants: { cost?: unknown }[] }>(
  ctx: AuthedRequest["ctx"],
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

function trackingFromFlags(body: Record<string, unknown>) {
  if (body.serialTracking) return "SERIAL" as const;
  if (body.batchTracking) return "BATCH" as const;
  if (body.expiryTracking) return "EXPIRY" as const;
  return "NONE" as const;
}

function productPayload(body: Record<string, unknown>, extra: { category?: string | null } = {}) {
  const type = String(body.type ?? "SIMPLE").toUpperCase();
  const mapped = type === "PHYSICAL" ? "SIMPLE" : type;
  return {
    name: body.name ? String(body.name) : undefined,
    code: body.code ? String(body.code).toUpperCase() : undefined,
    type: mapped as "SIMPLE" | "VARIABLE" | "SERVICE" | "DIGITAL" | "SUBSCRIPTION" | "BUNDLE" | "PHYSICAL",
    status: body.status ? (String(body.status).toUpperCase() as "ACTIVE" | "INACTIVE" | "DRAFT" | "ARCHIVED") : undefined,
    categoryId: body.categoryId === "" || body.categoryId === undefined ? undefined : String(body.categoryId),
    subcategoryId:
      body.subcategoryId === "" || body.subcategoryId === undefined ? null : String(body.subcategoryId),
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
    sellingPrice: body.sellingPrice != null && body.sellingPrice !== "" ? String(body.sellingPrice) : undefined,
    purchasePrice: body.purchasePrice != null && body.purchasePrice !== "" ? String(body.purchasePrice) : undefined,
    wholesalePrice: body.wholesalePrice != null && body.wholesalePrice !== "" ? String(body.wholesalePrice) : undefined,
    retailPrice: body.retailPrice != null && body.retailPrice !== "" ? String(body.retailPrice) : undefined,
    discount: body.discount != null && body.discount !== "" ? String(body.discount) : undefined,
    profitMargin: body.profitMargin != null && body.profitMargin !== "" ? String(body.profitMargin) : undefined,
    minStock: body.minStock != null && body.minStock !== "" ? String(body.minStock) : undefined,
    reorderLevel: body.reorderLevel != null && body.reorderLevel !== "" ? String(body.reorderLevel) : undefined,
    ...extra,
  };
}

catalogRouter.post("/uploads", manage, async (req, res) => {
  try {
    const dataUrl = String((req.body ?? {}).dataUrl ?? "");
    if (!dataUrl) return fail(res, "VALIDATION", "dataUrl required");
    const url = await saveDataUrl(dataUrl);
    return ok(res, { url }, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.get("/categories", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const list = parseListQuery(req.query, { sortable: ["name", "sortOrder", "createdAt"], defaultSort: "sortOrder", defaultOrder: "asc" });
  const status = acceptEnum(req.query.status, ["ACTIVE", "INACTIVE", "ARCHIVED", "DRAFT"] as const);
  const where = {
    tenantId: ctx.tenantId!,
    ...(status ? { status } : {}),
    ...(list.search ? { OR: [{ name: ilike(list.search) }, { slug: ilike(list.search) }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.category.findMany({
        where,
        include: { subcategories: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, slug: true, status: true } } },
        orderBy: list.sortBy === "name" || list.sortBy === "createdAt" ? { [list.sortBy]: list.sortOrder } : [{ sortOrder: "asc" }, { name: "asc" }],
        skip,
        take,
      }),
    count: () => prisma.category.count({ where }),
  });
  return okList(res, rows, pagination);
});

catalogRouter.post("/categories", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const name = String(req.body?.name ?? "").trim();
  if (!name) return fail(res, "VALIDATION", "name required");
  try {
    const row = await prisma.category.create({
      data: {
        tenantId: ctx.tenantId!,
        name,
        slug: slugify(req.body.slug || name),
        status: req.body.status ?? "ACTIVE",
        sortOrder: Number(req.body.sortOrder ?? 0),
      },
      include: { subcategories: true },
    });
    return ok(res, row, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.patch("/categories/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.category.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Category not found", 404);
  const name = req.body.name != null ? String(req.body.name).trim() : existing.name;
  const row = await prisma.category.update({
    where: { id: existing.id },
    data: {
      name,
      slug: req.body.slug ? slugify(req.body.slug) : existing.slug,
      status: req.body.status ?? existing.status,
      sortOrder: req.body.sortOrder != null ? Number(req.body.sortOrder) : existing.sortOrder,
    },
    include: { subcategories: true },
  });
  return ok(res, row);
});

catalogRouter.delete("/categories/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.category.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
    include: { _count: { select: { products: true, subcategories: true } } },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Category not found", 404);
  if (existing._count.products) return fail(res, "CONFLICT", "Category has products", 409);
  await prisma.subcategory.deleteMany({ where: { categoryId: existing.id } });
  await prisma.category.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});

catalogRouter.get("/subcategories", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const list = parseListQuery(req.query, { sortable: ["name", "sortOrder", "createdAt"], defaultSort: "sortOrder", defaultOrder: "asc" });
  const categoryId = acceptId(req.query.categoryId);
  const where = {
    tenantId: ctx.tenantId!,
    ...(categoryId ? { categoryId } : {}),
    ...(list.search ? { OR: [{ name: ilike(list.search) }, { slug: ilike(list.search) }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.subcategory.findMany({
        where,
        include: { category: { select: { id: true, name: true } } },
        orderBy: list.sortBy === "name" || list.sortBy === "createdAt" ? { [list.sortBy]: list.sortOrder } : [{ sortOrder: "asc" }, { name: "asc" }],
        skip,
        take,
      }),
    count: () => prisma.subcategory.count({ where }),
  });
  return okList(res, rows, pagination);
});

catalogRouter.post("/subcategories", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const name = String(req.body?.name ?? "").trim();
  const categoryId = String(req.body?.categoryId ?? "");
  if (!name || !categoryId) return fail(res, "VALIDATION", "name and categoryId required");
  const parent = await prisma.category.findFirst({ where: { id: categoryId, tenantId: ctx.tenantId! } });
  if (!parent) return fail(res, "VALIDATION", "Category not found");
  try {
    const row = await prisma.subcategory.create({
      data: {
        tenantId: ctx.tenantId!,
        categoryId,
        name,
        slug: slugify(req.body.slug || name),
        status: req.body.status ?? "ACTIVE",
        sortOrder: Number(req.body.sortOrder ?? 0),
      },
      include: { category: true },
    });
    return ok(res, row, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.patch("/subcategories/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.subcategory.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Subcategory not found", 404);
  if (req.body.categoryId) {
    const parent = await prisma.category.findFirst({ where: { id: String(req.body.categoryId), tenantId: ctx.tenantId! } });
    if (!parent) return fail(res, "VALIDATION", "Category not found");
  }
  const row = await prisma.subcategory.update({
    where: { id: existing.id },
    data: {
      name: req.body.name != null ? String(req.body.name).trim() : existing.name,
      slug: req.body.slug ? slugify(req.body.slug) : existing.slug,
      categoryId: req.body.categoryId ? String(req.body.categoryId) : existing.categoryId,
      status: req.body.status ?? existing.status,
      sortOrder: req.body.sortOrder != null ? Number(req.body.sortOrder) : existing.sortOrder,
    },
    include: { category: true },
  });
  return ok(res, row);
});

catalogRouter.delete("/subcategories/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.subcategory.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
    include: { _count: { select: { products: true } } },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Subcategory not found", 404);
  if (existing._count.products) return fail(res, "CONFLICT", "Subcategory has products", 409);
  await prisma.subcategory.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});

catalogRouter.get("/brands", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const list = parseListQuery(req.query, { sortable: ["name", "createdAt"], defaultSort: "name", defaultOrder: "asc" });
  const status = acceptEnum(req.query.status, ["ACTIVE", "INACTIVE", "ARCHIVED", "DRAFT"] as const);
  const where = {
    tenantId: ctx.tenantId!,
    ...(status ? { status } : {}),
    ...(list.search ? { name: ilike(list.search) } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) => prisma.brand.findMany({ where, orderBy: { [list.sortBy]: list.sortOrder }, skip, take }),
    count: () => prisma.brand.count({ where }),
  });
  return okList(res, rows, pagination);
});

catalogRouter.post("/brands", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const name = String(req.body?.name ?? "").trim();
  if (!name) return fail(res, "VALIDATION", "name required");
  try {
    return ok(res, await prisma.brand.create({ data: { tenantId: ctx.tenantId!, name, status: req.body.status ?? "ACTIVE" } }), undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.patch("/brands/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.brand.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Brand not found", 404);
  return ok(
    res,
    await prisma.brand.update({
      where: { id: existing.id },
      data: { name: req.body.name ?? existing.name, status: req.body.status ?? existing.status },
    }),
  );
});

catalogRouter.delete("/brands/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.brand.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
    include: { _count: { select: { products: true } } },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Brand not found", 404);
  if (existing._count.products) return fail(res, "CONFLICT", "Brand is used by products", 409);
  await prisma.brand.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});

catalogRouter.get("/units", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const list = parseListQuery(req.query, { sortable: ["name", "abbreviation", "sortOrder", "createdAt"], defaultSort: "sortOrder", defaultOrder: "asc" });
  const where = {
    tenantId: ctx.tenantId!,
    ...(list.search ? { OR: [{ name: ilike(list.search) }, { abbreviation: ilike(list.search) }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.unit.findMany({
        where,
        orderBy: list.sortBy === "name" || list.sortBy === "abbreviation" || list.sortBy === "createdAt" ? { [list.sortBy]: list.sortOrder } : [{ sortOrder: "asc" }, { name: "asc" }],
        skip,
        take,
      }),
    count: () => prisma.unit.count({ where }),
  });
  return okList(res, rows, pagination);
});

catalogRouter.post("/units", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const name = String(req.body?.name ?? "").trim();
  const abbreviation = String(req.body?.abbreviation ?? req.body?.code ?? "").trim();
  if (!name || !abbreviation) return fail(res, "VALIDATION", "name and abbreviation required");
  try {
    return ok(
      res,
      await prisma.unit.create({
        data: {
          tenantId: ctx.tenantId!,
          name,
          abbreviation,
          status: req.body.status ?? "ACTIVE",
          sortOrder: Number(req.body.sortOrder ?? 0),
        },
      }),
      undefined,
      201,
    );
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.patch("/units/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.unit.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Unit not found", 404);
  return ok(
    res,
    await prisma.unit.update({
      where: { id: existing.id },
      data: {
        name: req.body.name ?? existing.name,
        abbreviation: req.body.abbreviation ?? existing.abbreviation,
        status: req.body.status ?? existing.status,
        sortOrder: req.body.sortOrder != null ? Number(req.body.sortOrder) : existing.sortOrder,
      },
    }),
  );
});

catalogRouter.delete("/units/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.unit.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
    include: { _count: { select: { products: true, variants: true } } },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Unit not found", 404);
  if (existing._count.products || existing._count.variants) return fail(res, "CONFLICT", "Unit is in use", 409);
  await prisma.unit.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});

catalogRouter.get("/attributes", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const list = parseListQuery(req.query, { sortable: ["name", "key", "sortOrder"], defaultSort: "sortOrder", defaultOrder: "asc" });
  const where = {
    tenantId: ctx.tenantId!,
    ...(list.search ? { OR: [{ name: ilike(list.search) }, { key: ilike(list.search) }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.attributeDefinition.findMany({
        where,
        include: { options: { orderBy: { sortOrder: "asc" }, select: { id: true, value: true, label: true, sortOrder: true } } },
        orderBy: list.sortBy === "name" || list.sortBy === "key" ? { [list.sortBy]: list.sortOrder } : { sortOrder: "asc" },
        skip,
        take,
      }),
    count: () => prisma.attributeDefinition.count({ where }),
  });
  return okList(res, rows, pagination);
});

catalogRouter.post("/attributes", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const name = String(req.body?.name ?? "").trim();
  if (!name) return fail(res, "VALIDATION", "name required");
  const key = slugify(req.body.key || name).replace(/-/g, "_");
  try {
    const row = await prisma.attributeDefinition.create({
      data: {
        tenantId: ctx.tenantId!,
        key,
        name,
        dataType: req.body.dataType ?? "SELECT",
        variantDefining: req.body.variantDefining !== false,
        sortOrder: Number(req.body.sortOrder ?? 0),
        options: Array.isArray(req.body.options)
          ? {
              create: (req.body.options as { value?: string; label: string }[]).map((o, i) => ({
                value: slugify(o.value || o.label).replace(/-/g, "_"),
                label: o.label,
                sortOrder: i,
              })),
            }
          : undefined,
      },
      include: { options: true },
    });
    return ok(res, row, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.patch("/attributes/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.attributeDefinition.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Attribute not found", 404);
  const row = await prisma.attributeDefinition.update({
    where: { id: existing.id },
    data: {
      name: req.body.name ?? existing.name,
      variantDefining: req.body.variantDefining != null ? Boolean(req.body.variantDefining) : existing.variantDefining,
      sortOrder: req.body.sortOrder != null ? Number(req.body.sortOrder) : existing.sortOrder,
      dataType: req.body.dataType ?? existing.dataType,
    },
    include: { options: { orderBy: { sortOrder: "asc" } } },
  });
  return ok(res, row);
});

catalogRouter.delete("/attributes/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.attributeDefinition.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
    include: { options: { include: { _count: { select: { variantValues: true } } } } },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Attribute not found", 404);
  if (existing.options.some((o) => o._count.variantValues)) {
    return fail(res, "CONFLICT", "Attribute is used by product variants", 409);
  }
  await prisma.attributeOption.deleteMany({ where: { definitionId: existing.id } });
  await prisma.attributeDefinition.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});

catalogRouter.post("/attributes/:id/options", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const def = await prisma.attributeDefinition.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
  });
  if (!def) return fail(res, "NOT_FOUND", "Attribute not found", 404);
  const label = String(req.body?.label ?? req.body?.name ?? "").trim();
  if (!label) return fail(res, "VALIDATION", "label required");
  try {
    const row = await prisma.attributeOption.create({
      data: {
        definitionId: def.id,
        label,
        value: slugify(req.body.value || label).replace(/-/g, "_"),
        sortOrder: Number(req.body.sortOrder ?? 0),
      },
    });
    return ok(res, row, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.patch("/attribute-options/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.attributeOption.findFirst({
    where: { id: String(req.params.id), definition: { tenantId: ctx.tenantId! } },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Option not found", 404);
  const row = await prisma.attributeOption.update({
    where: { id: existing.id },
    data: {
      label: req.body.label ?? existing.label,
      value: req.body.value ? slugify(req.body.value).replace(/-/g, "_") : existing.value,
      sortOrder: req.body.sortOrder != null ? Number(req.body.sortOrder) : existing.sortOrder,
    },
  });
  return ok(res, row);
});

catalogRouter.delete("/attribute-options/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.attributeOption.findFirst({
    where: { id: String(req.params.id), definition: { tenantId: ctx.tenantId! } },
    include: { _count: { select: { variantValues: true } } },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Option not found", 404);
  if (existing._count.variantValues) return fail(res, "CONFLICT", "Option is used by variants", 409);
  await prisma.attributeOption.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});

catalogRouter.get("/tax-categories", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  return ok(res, await prisma.taxCategory.findMany({ where: { tenantId: ctx.tenantId! } }));
});

catalogRouter.get("/products", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const posOnly = req.query.pos === "1" || req.query.pos === "true";
  const list = parseListQuery(req.query, {
    sortable: ["name", "code", "createdAt", "status"],
    defaultSort: "name",
    defaultOrder: "asc",
    defaultLimit: posOnly ? 50 : 25,
  });
  const statusRaw = String(req.query.status ?? (posOnly ? "ACTIVE" : "ALL")).toUpperCase();
  const status = statusRaw === "ALL" ? undefined : acceptEnum(statusRaw, ["ACTIVE", "ARCHIVED", "DRAFT", "INACTIVE", "DISCONTINUED"] as const);
  const categoryId = acceptId(req.query.categoryId);
  const supplierId = acceptId(req.query.supplierId);
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
      prisma.product.findMany({
        where,
        include: productListInclude,
        orderBy: { [list.sortBy]: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.product.count({ where }),
  });
  const data = rows.map((p) => ({
    ...p,
    category: p.categoryRef?.name ?? p.category,
    variants: statusRaw === "ALL" ? p.variants : p.variants.filter((v) => v.status === "ACTIVE"),
  }));
  return okList(res, redactProducts(ctx, data), pagination);
});

catalogRouter.get("/variants", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const list = parseListQuery(req.query, { sortable: ["sku", "createdAt"], defaultSort: "sku", defaultOrder: "asc" });
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
    find: (skip, take) =>
      prisma.productVariant.findMany({
        where,
        select: {
          id: true,
          sku: true,
          price: true,
          cost: true,
          status: true,
          product: { select: { id: true, name: true, code: true } },
        },
        orderBy: { sku: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.productVariant.count({ where }),
  });
  const canCost = hasPermission(ctx, "catalog.manage") || hasPermission(ctx, "purchase.view");
  const data = rows.map((v) => ({
    id: v.id,
    sku: v.sku,
    price: v.price,
    cost: canCost ? v.cost : null,
    status: v.status,
    name: v.product.name,
    productId: v.product.id,
    code: v.product.code,
  }));
  return okList(res, data, pagination);
});

catalogRouter.get("/barcode/:code", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const code = String(req.params.code);
  const barcode = await prisma.barcode.findFirst({
    where: { tenantId: ctx.tenantId!, code, active: true },
    include: {
      variant: {
        include: {
          product: { include: { taxCategory: true } },
          attributes: { include: { option: { include: { definition: true } } } },
          stock: true,
          barcodes: { where: { active: true } },
        },
      },
    },
  });
  if (barcode) return ok(res, barcode);
  const bySku = await prisma.productVariant.findFirst({
    where: { tenantId: ctx.tenantId!, sku: code.toUpperCase() },
    include: {
      product: { include: { taxCategory: true } },
      attributes: { include: { option: { include: { definition: true } } } },
      stock: true,
      barcodes: { where: { active: true } },
    },
  });
  if (!bySku) return fail(res, "NOT_FOUND", "Barcode not found", 404);
  return ok(res, { code, variant: bySku, primary: true, kind: "SKU" });
});

catalogRouter.get("/products/:id/matrix", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const product = await prisma.product.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
    include: productInclude,
  });
  if (!product) return fail(res, "NOT_FOUND", "Product not found", 404);

  const tenant = await prisma.tenant.findFirst({ where: { id: ctx.tenantId! } });
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
  return ok(res, {
    product,
    axes: { row: rowKey, col: colKey },
    rows: [...rows.entries()].map(([value, label]) => ({ value, label })),
    cols: [...cols.entries()].map(([value, label]) => ({ value, label })),
    colours: [...rows.entries()].map(([value, label]) => ({ value, label })),
    sizes: [...cols.entries()].map(([value, label]) => ({ value, label })),
    cells,
  });
});

catalogRouter.get("/products/:id", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const product = await prisma.product.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
    include: productInclude,
  });
  if (!product) return fail(res, "NOT_FOUND", "Product not found", 404);
  return ok(res, redactProducts(ctx, [product])[0]);
});

catalogRouter.post("/products", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const name = String(body.name ?? "").trim();
  const code = String(body.code ?? "").trim().toUpperCase();
  const categoryId = String(body.categoryId ?? "");
  if (!name || !code) return fail(res, "VALIDATION", "name and code required");
  if (!categoryId) return fail(res, "VALIDATION", "category is required");
  const cat = await prisma.category.findFirst({ where: { id: categoryId, tenantId: ctx.tenantId! } });
  if (!cat) return fail(res, "VALIDATION", "Category not found");
  if (body.subcategoryId) {
    const sub = await prisma.subcategory.findFirst({
      where: { id: String(body.subcategoryId), tenantId: ctx.tenantId!, categoryId },
    });
    if (!sub) return fail(res, "VALIDATION", "Subcategory does not belong to the selected category");
  }
  try {
    await assertUniqueProductCode(ctx.tenantId!, code);
    if (body.barcode) await assertUniqueBarcode(ctx.tenantId!, String(body.barcode));
    const type = String(body.type ?? "SIMPLE").toUpperCase();
    const mappedType = type === "PHYSICAL" ? "SIMPLE" : type;
    const trackInventory = body.trackInventory != null ? Boolean(body.trackInventory) : mappedType !== "SERVICE" && mappedType !== "DIGITAL";
    const product = await prisma.product.create({
      data: {
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
        sellingPrice: body.sellingPrice != null && body.sellingPrice !== "" ? String(body.sellingPrice) : null,
        purchasePrice: body.purchasePrice != null && body.purchasePrice !== "" ? String(body.purchasePrice) : null,
        wholesalePrice: body.wholesalePrice != null && body.wholesalePrice !== "" ? String(body.wholesalePrice) : null,
        retailPrice: body.retailPrice != null && body.retailPrice !== "" ? String(body.retailPrice) : null,
        discount: String(body.discount ?? 0),
        profitMargin: body.profitMargin != null && body.profitMargin !== "" ? String(body.profitMargin) : null,
        minStock: String(body.minStock ?? 0),
        reorderLevel: String(body.reorderLevel ?? 0),
      },
    });

    const images = Array.isArray(body.images) ? (body.images as { url: string; isPrimary?: boolean; sortOrder?: number; alt?: string; variantId?: string }[]) : [];
    for (const [i, img] of images.entries()) {
      if (!img.url) continue;
      await prisma.productImage.create({
        data: {
          productId: product.id,
          url: img.url,
          alt: img.alt,
          isPrimary: Boolean(img.isPrimary) || i === 0,
          sortOrder: img.sortOrder ?? i,
        },
      });
    }

    const defaults: VariantInput = {
      price: String(body.sellingPrice ?? body.price ?? 0),
      cost: String(body.purchasePrice ?? body.cost ?? 0),
      discount: String(body.discount ?? 0),
      wholesalePrice: body.wholesalePrice != null ? String(body.wholesalePrice) : undefined,
      retailPrice: body.retailPrice != null ? String(body.retailPrice) : undefined,
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
      await prisma.product.update({ where: { id: product.id }, data: { type: "VARIABLE" } });
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
      await prisma.productBundleItem.createMany({
        data: bundleItems.map((b) => ({
          bundleProductId: product.id,
          variantId: b.variantId,
          qty: String(b.qty ?? 1),
        })),
      });
      await createVariantRecord(
        ctx,
        { id: product.id, code: product.code, unitId: product.unitId, trackInventory: false },
        { ...defaults, optionIds: [], sku: product.code, barcode: String(body.barcode || "") },
      );
    }

    const tracking = trackingFromFlags(body);
    if (tracking !== "NONE") {
      await prisma.productVariant.updateMany({ where: { productId: product.id }, data: { trackingType: tracking } });
    }

    await writeAudit({
      ctx,
      action: "catalog.create",
      entityType: "Product",
      entityId: product.id,
      after: { name, code },
      correlationId: (req as unknown as AuthedRequest).correlationId,
    });
    const full = await prisma.product.findFirst({ where: { id: product.id }, include: productInclude });
    return ok(res, full, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.patch("/products/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.product.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Product not found", 404);
  const body = (req.body ?? {}) as Record<string, unknown>;
  try {
    if (body.code) await assertUniqueProductCode(ctx.tenantId!, String(body.code), existing.id);
    const categoryId = body.categoryId != null ? String(body.categoryId) : existing.categoryId;
    if (body.categoryId && !categoryId) return fail(res, "VALIDATION", "category is required");
    const category = await categoryName(categoryId, ctx.tenantId!);
    if (body.subcategoryId && categoryId) {
      const sub = await prisma.subcategory.findFirst({
        where: { id: String(body.subcategoryId), tenantId: ctx.tenantId!, categoryId },
      });
      if (!sub) return fail(res, "VALIDATION", "Subcategory does not belong to the selected category");
    }
    const data = productPayload(body, { category: category ?? existing.category });
    const product = await prisma.product.update({
      where: { id: existing.id },
      data: {
        ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
      },
      include: productInclude,
    });
    if (Array.isArray(body.images)) {
      await prisma.productImage.deleteMany({ where: { productId: existing.id, variantId: null } });
      for (const [i, img] of (body.images as { url: string; isPrimary?: boolean; alt?: string }[]).entries()) {
        if (!img.url) continue;
        await prisma.productImage.create({
          data: {
            productId: existing.id,
            url: img.url,
            alt: img.alt,
            isPrimary: Boolean(img.isPrimary) || i === 0,
            sortOrder: i,
          },
        });
      }
    }
    const simple = body.simple as VariantInput | undefined;
    if (simple && product.type !== "VARIABLE") {
      const def = product.variants.find((v) => v.variantKey === DEFAULT_VARIANT_KEY) ?? product.variants[0];
      if (def) {
        await prisma.productVariant.update({
          where: { id: def.id },
          data: {
            ...(simple.sku ? { sku: String(simple.sku).toUpperCase() } : {}),
            ...(simple.price != null ? { price: String(simple.price) } : {}),
            ...(simple.cost != null ? { cost: String(simple.cost) } : {}),
            ...(simple.discount != null ? { discount: String(simple.discount) } : {}),
            ...(simple.minStock != null ? { minStock: String(simple.minStock) } : {}),
            ...(simple.status ? { status: simple.status as "ACTIVE" | "INACTIVE" } : {}),
          },
        });
        if (simple.barcode) {
          await assertUniqueBarcode(ctx.tenantId!, String(simple.barcode));
          await prisma.barcode.updateMany({ where: { variantId: def.id }, data: { primary: false } });
          await prisma.barcode.create({
            data: {
              tenantId: ctx.tenantId!,
              variantId: def.id,
              code: String(simple.barcode),
              kind: "CODE128",
              primary: true,
            },
          });
        }
      }
    }
    if (Array.isArray(body.bundleItems)) {
      await prisma.productBundleItem.deleteMany({ where: { bundleProductId: existing.id } });
      const rows = (body.bundleItems as { variantId: string; qty: string | number }[]).filter((b) => b.variantId);
      await assertVariantsInTenant(
        ctx.tenantId!,
        rows.map((b) => b.variantId),
      );
      if (rows.length) {
        await prisma.productBundleItem.createMany({
          data: rows.map((b) => ({
            bundleProductId: existing.id,
            variantId: b.variantId,
            qty: String(b.qty ?? 1),
          })),
        });
      }
    }
    return ok(res, await prisma.product.findFirst({ where: { id: existing.id }, include: productInclude }));
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.post("/products/:id/archive", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.product.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Product not found", 404);
  const product = await prisma.product.update({
    where: { id: existing.id },
    data: { status: "ARCHIVED" },
    include: productInclude,
  });
  await writeAudit({
    ctx,
    action: "catalog.archive",
    entityType: "Product",
    entityId: product.id,
    correlationId: (req as unknown as AuthedRequest).correlationId,
  });
  return ok(res, product);
});

catalogRouter.post("/products/:id/generate-variants", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const product = await prisma.product.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
  });
  if (!product) return fail(res, "NOT_FOUND", "Product not found", 404);
  const body = req.body ?? {};
  let axes = Array.isArray(body.axes) ? (body.axes as { definitionId: string; optionIds: string[] }[]) : [];
  if (!axes.length && Array.isArray(body.colourOptionIds) && Array.isArray(body.sizeOptionIds)) {
    const colour = await prisma.attributeDefinition.findFirst({ where: { tenantId: ctx.tenantId!, key: "colour" } });
    const size = await prisma.attributeDefinition.findFirst({ where: { tenantId: ctx.tenantId!, key: "size" } });
    axes = [
      { definitionId: colour?.id ?? "colour", optionIds: body.colourOptionIds },
      { definitionId: size?.id ?? "size", optionIds: body.sizeOptionIds },
    ];
  }
  if (!axes.length || axes.every((a) => !a.optionIds?.length)) {
    return fail(res, "VALIDATION", "Select at least one variant attribute with values");
  }
  try {
    const defaults = await prisma.productVariant.findMany({
      where: { productId: product.id, variantKey: DEFAULT_VARIANT_KEY },
      select: { id: true },
    });
    const defaultIds = defaults.map((d) => d.id);
    if (defaultIds.length) {
      await prisma.stockMovement.deleteMany({ where: { variantId: { in: defaultIds } } });
      await prisma.stock.deleteMany({ where: { variantId: { in: defaultIds } } });
      await prisma.barcode.deleteMany({ where: { variantId: { in: defaultIds } } });
      await prisma.productImage.updateMany({ where: { variantId: { in: defaultIds } }, data: { variantId: null } });
      await prisma.productVariant.deleteMany({ where: { id: { in: defaultIds } } });
    }
    const created = await generateFromAxes(
      ctx,
      { id: product.id, code: product.code, unitId: product.unitId, trackInventory: product.trackInventory },
      axes,
      {
        price: body.price,
        cost: body.cost,
        discount: body.discount,
        openingStock: body.openingStock,
      },
      Array.isArray(body.variants) ? body.variants : [],
    );
    await prisma.product.update({ where: { id: product.id }, data: { type: "VARIABLE" } });
    const full = await prisma.product.findFirst({ where: { id: product.id }, include: productInclude });
    return ok(res, { product: full, created: created.length });
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.patch("/variants/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.productVariant.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Variant not found", 404);
  const { sku, price, cost, status, discount, minStock, weight, imageUrl, wholesalePrice, retailPrice, unitId } = req.body ?? {};
  try {
    if (sku) await prisma.productVariant.findFirst({ where: { tenantId: ctx.tenantId!, sku: String(sku).toUpperCase(), id: { not: existing.id } } }).then((hit) => {
      if (hit) throw Object.assign(new Error("SKU already exists"), { code: "CONFLICT" });
    });
    const variant = await prisma.productVariant.update({
      where: { id: existing.id },
      data: {
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
      },
      include: { barcodes: true, stock: true, attributes: { include: { option: { include: { definition: true } } } } },
    });
    return ok(res, variant);
  } catch (e) {
    return handleErr(res, e);
  }
});

catalogRouter.delete("/variants/:id", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.productVariant.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Variant not found", 404);
  await prisma.stockMovement.deleteMany({ where: { variantId: existing.id } });
  await prisma.stock.deleteMany({ where: { variantId: existing.id } });
  await prisma.barcode.deleteMany({ where: { variantId: existing.id } });
  await prisma.variantAttributeValue.deleteMany({ where: { variantId: existing.id } });
  await prisma.productImage.updateMany({ where: { variantId: existing.id }, data: { variantId: null } });
  await prisma.productVariant.delete({ where: { id: existing.id } });
  return ok(res, { id: existing.id });
});

catalogRouter.post("/variants/:id/barcodes", manage, async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.productVariant.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Variant not found", 404);
  const { code, kind, primary } = req.body ?? {};
  if (!code) return fail(res, "VALIDATION", "code required");
  try {
    await assertUniqueBarcode(ctx.tenantId!, String(code));
    if (primary) {
      await prisma.barcode.updateMany({ where: { variantId: existing.id, tenantId: ctx.tenantId! }, data: { primary: false } });
    }
    const row = await prisma.barcode.create({
      data: {
        tenantId: ctx.tenantId!,
        variantId: existing.id,
        code: String(code),
        kind: kind ?? "CODE128",
        primary: Boolean(primary),
      },
    });
    return ok(res, row, undefined, 201);
  } catch {
    return fail(res, "CONFLICT", "Barcode already in use", 409);
  }
});
