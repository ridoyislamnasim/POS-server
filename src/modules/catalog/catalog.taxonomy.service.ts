import { acceptEnum, acceptId, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { slugify } from "./catalog.service.js";
import { catalogRepository } from "./catalog.repository.js";
import type {
  AttributeInput,
  BrandInput,
  CategoryInput,
  OptionInput,
  SubcategoryInput,
  UnitInput,
} from "./catalog.types.js";

/**
 * Taxonomy business logic (categories → attribute options).
 * No Express `req`/`res` here.
 */
export const catalogTaxonomyService = {
  // -- categories
  async listCategories(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["name", "sortOrder", "createdAt"],
      defaultSort: "sortOrder",
      defaultOrder: "asc",
    });
    const status = acceptEnum(query.status, ["ACTIVE", "INACTIVE", "ARCHIVED", "DRAFT"] as const);
    const where = {
      tenantId: ctx.tenantId!,
      ...(status ? { status } : {}),
      ...(list.search ? { OR: [{ name: ilike(list.search) }, { slug: ilike(list.search) }] } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        catalogRepository.listCategories({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "name" || list.sortBy === "createdAt"
              ? { [list.sortBy]: list.sortOrder }
              : [{ sortOrder: "asc" }, { name: "asc" }],
        }),
      count: () => catalogRepository.countCategories(where),
    });
  },

  async createCategory(ctx: RequestContext, input: CategoryInput) {
    const name = String(input.name ?? "").trim();
    if (!name) throw new AppError("VALIDATION", "name required", 400);
    return catalogRepository.createCategory({
      tenantId: ctx.tenantId!,
      name,
      slug: slugify(String(input.slug || name)),
      status: (input.status as "ACTIVE" | "INACTIVE" | "ARCHIVED" | "DRAFT") ?? "ACTIVE",
      sortOrder: Number(input.sortOrder ?? 0),
    });
  },

  async updateCategory(ctx: RequestContext, id: string, input: CategoryInput) {
    const existing = await catalogRepository.findCategory(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Category not found", 404);
    const name = input.name != null ? String(input.name).trim() : existing.name;
    return catalogRepository.updateCategory(existing.id, {
      name,
      slug: input.slug ? slugify(input.slug) : existing.slug,
      status: input.status ?? existing.status,
      sortOrder: input.sortOrder != null ? Number(input.sortOrder) : existing.sortOrder,
    });
  },

  async deleteCategory(ctx: RequestContext, id: string) {
    const existing = await catalogRepository.findCategoryWithCounts(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Category not found", 404);
    if (existing._count.products) throw new AppError("CONFLICT", "Category has products", 409);
    await catalogRepository.deleteCategory(existing.id);
    return { id: existing.id };
  },

  // -- subcategories
  async listSubcategories(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["name", "sortOrder", "createdAt"],
      defaultSort: "sortOrder",
      defaultOrder: "asc",
    });
    const categoryId = acceptId(query.categoryId);
    const where = {
      tenantId: ctx.tenantId!,
      ...(categoryId ? { categoryId } : {}),
      ...(list.search ? { OR: [{ name: ilike(list.search) }, { slug: ilike(list.search) }] } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        catalogRepository.listSubcategories({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "name" || list.sortBy === "createdAt"
              ? { [list.sortBy]: list.sortOrder }
              : [{ sortOrder: "asc" }, { name: "asc" }],
        }),
      count: () => catalogRepository.countSubcategories(where),
    });
  },

  async createSubcategory(ctx: RequestContext, input: SubcategoryInput) {
    const name = String(input.name ?? "").trim();
    const categoryId = String(input.categoryId ?? "");
    if (!name || !categoryId) throw new AppError("VALIDATION", "name and categoryId required", 400);
    const parent = await catalogRepository.findCategory(ctx.tenantId!, categoryId);
    if (!parent) throw new AppError("VALIDATION", "Category not found", 400);
    return catalogRepository.createSubcategory({
      tenantId: ctx.tenantId!,
      categoryId,
      name,
      slug: slugify(String(input.slug || name)),
      status: (input.status as "ACTIVE" | "INACTIVE" | "ARCHIVED" | "DRAFT") ?? "ACTIVE",
      sortOrder: Number(input.sortOrder ?? 0),
    });
  },

  async updateSubcategory(ctx: RequestContext, id: string, input: SubcategoryInput & { status?: string; slug?: string; sortOrder?: number | string; name?: string; categoryId?: string }) {
    const existing = await catalogRepository.findSubcategory(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Subcategory not found", 404);
    if (input.categoryId) {
      const parent = await catalogRepository.findCategory(ctx.tenantId!, String(input.categoryId));
      if (!parent) throw new AppError("VALIDATION", "Category not found", 400);
    }
    return catalogRepository.updateSubcategory(existing.id, {
      name: input.name != null ? String(input.name).trim() : existing.name,
      slug: input.slug ? slugify(input.slug) : existing.slug,
      categoryId: input.categoryId ? String(input.categoryId) : existing.categoryId,
      status: input.status ?? existing.status,
      sortOrder: input.sortOrder != null ? Number(input.sortOrder) : existing.sortOrder,
    });
  },

  async deleteSubcategory(ctx: RequestContext, id: string) {
    const existing = await catalogRepository.findSubcategoryWithCounts(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Subcategory not found", 404);
    if (existing._count.products) throw new AppError("CONFLICT", "Subcategory has products", 409);
    await catalogRepository.deleteSubcategory(existing.id);
    return { id: existing.id };
  },

  // -- brands
  async listBrands(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, { sortable: ["name", "createdAt"], defaultSort: "name", defaultOrder: "asc" });
    const status = acceptEnum(query.status, ["ACTIVE", "INACTIVE", "ARCHIVED", "DRAFT"] as const);
    const where = {
      tenantId: ctx.tenantId!,
      ...(status ? { status } : {}),
      ...(list.search ? { name: ilike(list.search) } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        catalogRepository.listBrands({ where, skip, take, orderBy: { [list.sortBy]: list.sortOrder } }),
      count: () => catalogRepository.countBrands(where),
    });
  },

  async createBrand(ctx: RequestContext, input: BrandInput) {
    const name = String(input.name ?? "").trim();
    if (!name) throw new AppError("VALIDATION", "name required", 400);
    return catalogRepository.createBrand({
      tenantId: ctx.tenantId!,
      name,
      status: (input.status as "ACTIVE" | "INACTIVE" | "ARCHIVED" | "DRAFT") ?? "ACTIVE",
    });
  },

  async updateBrand(ctx: RequestContext, id: string, input: BrandInput) {
    const existing = await catalogRepository.findBrand(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Brand not found", 404);
    return catalogRepository.updateBrand(existing.id, {
      name: input.name ?? existing.name,
      status: input.status ?? existing.status,
    });
  },

  async deleteBrand(ctx: RequestContext, id: string) {
    const existing = await catalogRepository.findBrandWithCounts(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Brand not found", 404);
    if (existing._count.products) throw new AppError("CONFLICT", "Brand is used by products", 409);
    await catalogRepository.deleteBrand(existing.id);
    return { id: existing.id };
  },

  // -- units
  async listUnits(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["name", "abbreviation", "sortOrder", "createdAt"],
      defaultSort: "sortOrder",
      defaultOrder: "asc",
    });
    const where = {
      tenantId: ctx.tenantId!,
      ...(list.search ? { OR: [{ name: ilike(list.search) }, { abbreviation: ilike(list.search) }] } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        catalogRepository.listUnits({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "name" || list.sortBy === "abbreviation" || list.sortBy === "createdAt"
              ? { [list.sortBy]: list.sortOrder }
              : [{ sortOrder: "asc" }, { name: "asc" }],
        }),
      count: () => catalogRepository.countUnits(where),
    });
  },

  async createUnit(ctx: RequestContext, input: UnitInput) {
    const name = String(input.name ?? "").trim();
    const abbreviation = String(input.abbreviation ?? input.code ?? "").trim();
    if (!name || !abbreviation) throw new AppError("VALIDATION", "name and abbreviation required", 400);
    return catalogRepository.createUnit({
      tenantId: ctx.tenantId!,
      name,
      abbreviation,
      status: (input.status as "ACTIVE" | "INACTIVE") ?? "ACTIVE",
      sortOrder: Number(input.sortOrder ?? 0),
    });
  },

  async updateUnit(ctx: RequestContext, id: string, input: UnitInput) {
    const existing = await catalogRepository.findUnit(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Unit not found", 404);
    return catalogRepository.updateUnit(existing.id, {
      name: input.name ?? existing.name,
      abbreviation: input.abbreviation ?? existing.abbreviation,
      status: input.status ?? existing.status,
      sortOrder: input.sortOrder != null ? Number(input.sortOrder) : existing.sortOrder,
    });
  },

  async deleteUnit(ctx: RequestContext, id: string) {
    const existing = await catalogRepository.findUnitWithCounts(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Unit not found", 404);
    if (existing._count.products || existing._count.variants) {
      throw new AppError("CONFLICT", "Unit is in use", 409);
    }
    await catalogRepository.deleteUnit(existing.id);
    return { id: existing.id };
  },

  // -- attributes
  async listAttributes(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["name", "key", "sortOrder"],
      defaultSort: "sortOrder",
      defaultOrder: "asc",
    });
    const where = {
      tenantId: ctx.tenantId!,
      ...(list.search ? { OR: [{ name: ilike(list.search) }, { key: ilike(list.search) }] } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        catalogRepository.listAttributes({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "name" || list.sortBy === "key" ? { [list.sortBy]: list.sortOrder } : { sortOrder: "asc" },
        }),
      count: () => catalogRepository.countAttributes(where),
    });
  },

  async createAttribute(ctx: RequestContext, input: AttributeInput) {
    const name = String(input.name ?? "").trim();
    if (!name) throw new AppError("VALIDATION", "name required", 400);
    const key = slugify(input.key || name).replace(/-/g, "_");
    return catalogRepository.createAttribute({
      tenantId: ctx.tenantId!,
      key,
      name,
      dataType: (input.dataType ?? "SELECT") as never,
      variantDefining: input.variantDefining !== false,
      sortOrder: Number(input.sortOrder ?? 0),
      options: Array.isArray(input.options)
        ? {
            create: input.options.map((o, i) => ({
              value: slugify(o.value || o.label).replace(/-/g, "_"),
              label: o.label,
              sortOrder: i,
            })),
          }
        : undefined,
    });
  },

  async updateAttribute(ctx: RequestContext, id: string, input: AttributeInput) {
    const existing = await catalogRepository.findAttribute(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Attribute not found", 404);
    return catalogRepository.updateAttribute(existing.id, {
      name: input.name ?? existing.name,
      variantDefining: input.variantDefining != null ? Boolean(input.variantDefining) : existing.variantDefining,
      sortOrder: input.sortOrder != null ? Number(input.sortOrder) : existing.sortOrder,
      dataType: input.dataType ?? existing.dataType,
    });
  },

  async deleteAttribute(ctx: RequestContext, id: string) {
    const existing = await catalogRepository.findAttributeWithUsage(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Attribute not found", 404);
    if (existing.options.some((o) => o._count.variantValues)) {
      throw new AppError("CONFLICT", "Attribute is used by product variants", 409);
    }
    await catalogRepository.deleteAttribute(existing.id);
    return { id: existing.id };
  },

  // -- options
  async createOption(ctx: RequestContext, definitionId: string, input: OptionInput) {
    const def = await catalogRepository.findAttribute(ctx.tenantId!, definitionId);
    if (!def) throw new AppError("NOT_FOUND", "Attribute not found", 404);
    const label = String(input.label ?? input.name ?? "").trim();
    if (!label) throw new AppError("VALIDATION", "label required", 400);
    return catalogRepository.createOption({
      definitionId: def.id,
      label,
      value: slugify(input.value || label).replace(/-/g, "_"),
      sortOrder: Number(input.sortOrder ?? 0),
    });
  },

  async updateOption(ctx: RequestContext, id: string, input: OptionInput) {
    const existing = await catalogRepository.findOption(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Option not found", 404);
    return catalogRepository.updateOption(existing.id, {
      label: input.label ?? existing.label,
      value: input.value ? slugify(input.value).replace(/-/g, "_") : existing.value,
      sortOrder: input.sortOrder != null ? Number(input.sortOrder) : existing.sortOrder,
    });
  },

  async deleteOption(ctx: RequestContext, id: string) {
    const existing = await catalogRepository.findOptionWithUsage(ctx.tenantId!, id);
    if (!existing) throw new AppError("NOT_FOUND", "Option not found", 404);
    if (existing._count.variantValues) throw new AppError("CONFLICT", "Option is used by variants", 409);
    await catalogRepository.deleteOption(existing.id);
    return { id: existing.id };
  },

  listTaxCategories(ctx: RequestContext) {
    return catalogRepository.listTaxCategories(ctx.tenantId!);
  },
};
