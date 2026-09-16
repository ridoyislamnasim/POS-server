import { prisma } from "../../lib/prisma.js";
import { productInclude, productListInclude } from "./catalog.service.js";

/**
 * Data-access for the catalog. No business rules here —
 * uniqueness guards, redaction and variant orchestration live in services.
 */
export const catalogRepository = {
  // -- categories
  listCategories(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> | Record<string, unknown>[] }) {
    return prisma.category.findMany({
      where: opts.where as never,
      include: {
        subcategories: { orderBy: { sortOrder: "asc" }, select: { id: true, name: true, slug: true, status: true } },
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countCategories(where: Record<string, unknown>) {
    return prisma.category.count({ where: where as never });
  },

  createCategory(data: Parameters<typeof prisma.category.create>[0]["data"]) {
    return prisma.category.create({ data, include: { subcategories: true } });
  },

  findCategory(tenantId: string, id: string) {
    return prisma.category.findFirst({ where: { id, tenantId } });
  },

  findCategoryWithCounts(tenantId: string, id: string) {
    return prisma.category.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { products: true, subcategories: true } } },
    });
  },

  categoryName(categoryId: string, tenantId: string) {
    return prisma.category.findFirst({ where: { id: categoryId, tenantId } });
  },

  updateCategory(id: string, data: Record<string, unknown>) {
    return prisma.category.update({ where: { id }, data: data as never, include: { subcategories: true } });
  },

  deleteCategory(id: string) {
    return prisma.$transaction(async (tx) => {
      await tx.subcategory.deleteMany({ where: { categoryId: id } });
      await tx.category.delete({ where: { id } });
    });
  },

  // -- subcategories
  listSubcategories(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> | Record<string, unknown>[] }) {
    return prisma.subcategory.findMany({
      where: opts.where as never,
      include: { category: { select: { id: true, name: true } } },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countSubcategories(where: Record<string, unknown>) {
    return prisma.subcategory.count({ where: where as never });
  },

  createSubcategory(data: Parameters<typeof prisma.subcategory.create>[0]["data"]) {
    return prisma.subcategory.create({ data, include: { category: true } });
  },

  findSubcategory(tenantId: string, id: string) {
    return prisma.subcategory.findFirst({ where: { id, tenantId } });
  },

  findSubcategoryInCategory(tenantId: string, id: string, categoryId: string) {
    return prisma.subcategory.findFirst({ where: { id, tenantId, categoryId } });
  },

  findSubcategoryWithCounts(tenantId: string, id: string) {
    return prisma.subcategory.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { products: true } } },
    });
  },

  updateSubcategory(id: string, data: Record<string, unknown>) {
    return prisma.subcategory.update({ where: { id }, data: data as never, include: { category: true } });
  },

  deleteSubcategory(id: string) {
    return prisma.subcategory.delete({ where: { id } });
  },

  // -- brands
  listBrands(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.brand.findMany({ where: opts.where as never, orderBy: opts.orderBy as never, skip: opts.skip, take: opts.take });
  },

  countBrands(where: Record<string, unknown>) {
    return prisma.brand.count({ where: where as never });
  },

  createBrand(data: Parameters<typeof prisma.brand.create>[0]["data"]) {
    return prisma.brand.create({ data });
  },

  findBrand(tenantId: string, id: string) {
    return prisma.brand.findFirst({ where: { id, tenantId } });
  },

  findBrandWithCounts(tenantId: string, id: string) {
    return prisma.brand.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { products: true } } },
    });
  },

  updateBrand(id: string, data: Record<string, unknown>) {
    return prisma.brand.update({ where: { id }, data: data as never });
  },

  deleteBrand(id: string) {
    return prisma.brand.delete({ where: { id } });
  },

  // -- units
  listUnits(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> | Record<string, unknown>[] }) {
    return prisma.unit.findMany({ where: opts.where as never, orderBy: opts.orderBy as never, skip: opts.skip, take: opts.take });
  },

  countUnits(where: Record<string, unknown>) {
    return prisma.unit.count({ where: where as never });
  },

  createUnit(data: Parameters<typeof prisma.unit.create>[0]["data"]) {
    return prisma.unit.create({ data });
  },

  findUnit(tenantId: string, id: string) {
    return prisma.unit.findFirst({ where: { id, tenantId } });
  },

  findUnitWithCounts(tenantId: string, id: string) {
    return prisma.unit.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { products: true, variants: true } } },
    });
  },

  updateUnit(id: string, data: Record<string, unknown>) {
    return prisma.unit.update({ where: { id }, data: data as never });
  },

  deleteUnit(id: string) {
    return prisma.unit.delete({ where: { id } });
  },

  // -- attributes & options
  listAttributes(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.attributeDefinition.findMany({
      where: opts.where as never,
      include: { options: { orderBy: { sortOrder: "asc" }, select: { id: true, value: true, label: true, sortOrder: true } } },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countAttributes(where: Record<string, unknown>) {
    return prisma.attributeDefinition.count({ where: where as never });
  },

  createAttribute(data: Parameters<typeof prisma.attributeDefinition.create>[0]["data"]) {
    return prisma.attributeDefinition.create({ data, include: { options: true } });
  },

  findAttribute(tenantId: string, id: string) {
    return prisma.attributeDefinition.findFirst({ where: { id, tenantId } });
  },

  findAttributeByKey(tenantId: string, key: string) {
    return prisma.attributeDefinition.findFirst({ where: { tenantId, key } });
  },

  findAttributeWithUsage(tenantId: string, id: string) {
    return prisma.attributeDefinition.findFirst({
      where: { id, tenantId },
      include: { options: { include: { _count: { select: { variantValues: true } } } } },
    });
  },

  updateAttribute(id: string, data: Record<string, unknown>) {
    return prisma.attributeDefinition.update({
      where: { id },
      data: data as never,
      include: { options: { orderBy: { sortOrder: "asc" } } },
    });
  },

  deleteAttribute(id: string) {
    return prisma.$transaction(async (tx) => {
      await tx.attributeOption.deleteMany({ where: { definitionId: id } });
      await tx.attributeDefinition.delete({ where: { id } });
    });
  },

  createOption(data: Parameters<typeof prisma.attributeOption.create>[0]["data"]) {
    return prisma.attributeOption.create({ data });
  },

  findOption(tenantId: string, id: string) {
    return prisma.attributeOption.findFirst({ where: { id, definition: { tenantId } } });
  },

  findOptionWithUsage(tenantId: string, id: string) {
    return prisma.attributeOption.findFirst({
      where: { id, definition: { tenantId } },
      include: { _count: { select: { variantValues: true } } },
    });
  },

  updateOption(id: string, data: Record<string, unknown>) {
    return prisma.attributeOption.update({ where: { id }, data: data as never });
  },

  deleteOption(id: string) {
    return prisma.attributeOption.delete({ where: { id } });
  },

  // -- tax categories
  listTaxCategories(tenantId: string) {
    return prisma.taxCategory.findMany({ where: { tenantId } });
  },

  // -- products
  listProducts(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.product.findMany({
      where: opts.where as never,
      include: productListInclude,
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countProducts(where: Record<string, unknown>) {
    return prisma.product.count({ where: where as never });
  },

  findProductDetail(tenantId: string, id: string) {
    return prisma.product.findFirst({ where: { id, tenantId }, include: productInclude });
  },

  findProduct(tenantId: string, id: string) {
    return prisma.product.findFirst({ where: { id, tenantId } });
  },

  createProduct(data: Parameters<typeof prisma.product.create>[0]["data"]) {
    return prisma.product.create({ data });
  },

  updateProduct(id: string, data: Record<string, unknown>) {
    return prisma.product.update({ where: { id }, data: data as never, include: productInclude });
  },

  updateProductType(id: string, type: "VARIABLE") {
    return prisma.product.update({ where: { id }, data: { type } });
  },

  archiveProduct(id: string) {
    return prisma.product.update({ where: { id }, data: { status: "ARCHIVED" }, include: productInclude });
  },

  createImage(data: Parameters<typeof prisma.productImage.create>[0]["data"]) {
    return prisma.productImage.create({ data });
  },

  replaceProductImages(productId: string, images: { url: string; alt?: string; isPrimary: boolean; sortOrder: number }[]) {
    return prisma.$transaction(async (tx) => {
      await tx.productImage.deleteMany({ where: { productId, variantId: null } });
      for (const img of images) {
        if (!img.url) continue;
        await tx.productImage.create({ data: { productId, ...img } });
      }
    });
  },

  createBundleItems(rows: { bundleProductId: string; variantId: string; qty: string }[]) {
    return prisma.productBundleItem.createMany({ data: rows });
  },

  replaceBundleItems(bundleProductId: string, rows: { bundleProductId: string; variantId: string; qty: string }[]) {
    return prisma.$transaction(async (tx) => {
      await tx.productBundleItem.deleteMany({ where: { bundleProductId } });
      if (rows.length) await tx.productBundleItem.createMany({ data: rows });
    });
  },

  setVariantTracking(productId: string, trackingType: string) {
    return prisma.productVariant.updateMany({ where: { productId }, data: { trackingType: trackingType as never } });
  },

  findTenant(tenantId: string) {
    return prisma.tenant.findFirst({ where: { id: tenantId } });
  },

  // -- variants & barcodes
  listVariants(opts: { where: Record<string, unknown>; skip: number; take: number; order: "asc" | "desc" }) {
    return prisma.productVariant.findMany({
      where: opts.where as never,
      select: {
        id: true,
        sku: true,
        price: true,
        cost: true,
        status: true,
        product: { select: { id: true, name: true, code: true } },
      },
      orderBy: { sku: opts.order },
      skip: opts.skip,
      take: opts.take,
    });
  },

  countVariants(where: Record<string, unknown>) {
    return prisma.productVariant.count({ where: where as never });
  },

  findBarcode(tenantId: string, code: string) {
    return prisma.barcode.findFirst({
      where: { tenantId, code, active: true },
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
  },

  findVariantBySku(tenantId: string, sku: string) {
    return prisma.productVariant.findFirst({
      where: { tenantId, sku },
      include: {
        product: { include: { taxCategory: true } },
        attributes: { include: { option: { include: { definition: true } } } },
        stock: true,
        barcodes: { where: { active: true } },
      },
    });
  },

  findVariant(tenantId: string, id: string) {
    return prisma.productVariant.findFirst({ where: { id, tenantId } });
  },

  findVariantSku(tenantId: string, sku: string, excludeId: string) {
    return prisma.productVariant.findFirst({ where: { tenantId, sku, id: { not: excludeId } } });
  },

  updateVariant(id: string, data: Record<string, unknown>) {
    return prisma.productVariant.update({
      where: { id },
      data: data as never,
      include: {
        barcodes: true,
        stock: true,
        attributes: { include: { option: { include: { definition: true } } } },
      },
    });
  },

  listProductVariants(tenantId: string, productId: string) {
    return prisma.productVariant.findMany({
      where: { productId, tenantId },
      include: { barcodes: { where: { active: true } } },
    });
  },

  findDefaultVariants(productId: string) {
    return prisma.productVariant.findMany({
      where: { productId, variantKey: "default" },
      select: { id: true },
    });
  },

  deleteVariantsCascade(ids: string[]) {
    return prisma.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { variantId: { in: ids } } });
      await tx.stock.deleteMany({ where: { variantId: { in: ids } } });
      await tx.barcode.deleteMany({ where: { variantId: { in: ids } } });
      await tx.productImage.updateMany({ where: { variantId: { in: ids } }, data: { variantId: null } });
      await tx.productVariant.deleteMany({ where: { id: { in: ids } } });
    });
  },

  deleteVariantCascade(id: string) {
    return prisma.$transaction(async (tx) => {
      await tx.stockMovement.deleteMany({ where: { variantId: id } });
      await tx.stock.deleteMany({ where: { variantId: id } });
      await tx.barcode.deleteMany({ where: { variantId: id } });
      await tx.variantAttributeValue.deleteMany({ where: { variantId: id } });
      await tx.productImage.updateMany({ where: { variantId: id }, data: { variantId: null } });
      await tx.productVariant.delete({ where: { id } });
    });
  },

  countVariantsInTenant(tenantId: string, ids: string[]) {
    return prisma.productVariant.count({ where: { tenantId, id: { in: ids } } });
  },

  updateBarcode(id: string, data: Record<string, unknown>) {
    return prisma.barcode.update({ where: { id }, data: data as never });
  },

  demoteVariantBarcodes(tenantId: string, variantId: string) {
    return prisma.barcode.updateMany({ where: { variantId, tenantId }, data: { primary: false } });
  },

  demoteAllVariantBarcodes(variantId: string) {
    return prisma.barcode.updateMany({ where: { variantId }, data: { primary: false } });
  },

  createBarcode(data: Parameters<typeof prisma.barcode.create>[0]["data"]) {
    return prisma.barcode.create({ data });
  },
};
