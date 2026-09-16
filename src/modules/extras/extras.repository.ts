import { prisma } from "../../lib/prisma.js";

/** Data-access for import/export helpers. No business rules here. */
export const extrasRepository = {
  upsertProduct(tenantId: string, code: string, name: string, category: string | null) {
    return prisma.product.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: { tenantId, name, code, category: category || null },
      update: { name, category: category || undefined },
    });
  },

  upsertVariant(
    tenantId: string,
    productId: string,
    sku: string,
    price?: string,
    cost?: string,
  ) {
    return prisma.productVariant.upsert({
      where: { tenantId_sku: { tenantId, sku } },
      create: {
        tenantId,
        productId,
        sku,
        variantKey: "default",
        price: String(price || 0),
        cost: String(cost || 0),
      },
      update: {
        price: price ? String(price) : undefined,
        cost: cost ? String(cost) : undefined,
      },
    });
  },

  upsertCustomer(
    tenantId: string,
    phoneCanonical: string,
    create: { name: string; phone: string; email: string | null; address: string | null },
    update: { name: string; email?: string; address?: string },
  ) {
    return prisma.customer.upsert({
      where: { tenantId_phoneCanonical: { tenantId, phoneCanonical } },
      create: { tenantId, phoneCanonical, ...create },
      update,
    });
  },

  listProductsWithVariants(tenantId: string) {
    return prisma.product.findMany({ where: { tenantId }, include: { variants: true } });
  },

  listCustomers(tenantId: string) {
    return prisma.customer.findMany({ where: { tenantId } });
  },
};
