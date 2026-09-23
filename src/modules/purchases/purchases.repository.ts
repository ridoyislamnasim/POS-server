import { prisma } from "../../lib/prisma.js";

/** Data-access for purchases/orders/returns. No business rules here. */
export const purchasesRepository = {
  listPurchases(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.purchase.findMany({
      where: opts.where as never,
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        paid: true,
        due: true,
        status: true,
        createdAt: true,
        supplier: { select: { id: true, name: true, phone: true } },
        branch: { select: { name: true } },
        items: { select: { id: true, variantId: true, qty: true, unitCost: true } },
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countPurchases(where: Record<string, unknown>) {
    return prisma.purchase.count({ where: where as never });
  },

  listOrders(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.purchaseOrder.findMany({
      where: opts.where as never,
      select: {
        id: true,
        number: true,
        total: true,
        status: true,
        createdAt: true,
        supplier: { select: { id: true, name: true } },
        branch: { select: { name: true } },
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countOrders(where: Record<string, unknown>) {
    return prisma.purchaseOrder.count({ where: where as never });
  },

  findOrder(id: string, tenantId: string, withPurchases = false) {
    return prisma.purchaseOrder.findFirst({
      where: { id, tenantId },
      include: {
        supplier: true,
        branch: { select: { name: true, locationId: true } },
        items: {
          include: {
            variant: {
              include: {
                product: { select: { id: true, name: true, code: true } },
                attributes: { include: { option: { include: { definition: true } } } },
                barcodes: { where: { active: true } },
              },
            },
          },
          orderBy: { variantId: "asc" },
        },
        purchases: {
          include: { items: { select: { variantId: true, qty: true } } },
        },
      },
    });
  },

  createOrder(data: Parameters<typeof prisma.purchaseOrder.create>[0]["data"]) {
    return prisma.purchaseOrder.create({ data, include: { items: true, supplier: true } });
  },

  cancelOrder(id: string) {
    return prisma.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: { supplier: true, items: true },
    });
  },

  findBranch(id: string, tenantId: string) {
    return prisma.branch.findFirst({ where: { id, tenantId } });
  },

  countVariants(tenantId: string, ids: string[]) {
    return prisma.productVariant.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true } });
  },

  listReturns(opts: { where: Record<string, unknown>; skip: number; take: number; order: "asc" | "desc" }) {
    return prisma.purchaseReturn.findMany({
      where: opts.where as never,
      select: {
        id: true,
        number: true,
        reason: true,
        total: true,
        createdAt: true,
        purchase: { select: { invoiceNumber: true, supplier: { select: { id: true, name: true, phone: true } } } },
      },
      orderBy: { createdAt: opts.order },
      skip: opts.skip,
      take: opts.take,
    });
  },

  countReturns(where: Record<string, unknown>) {
    return prisma.purchaseReturn.count({ where: where as never });
  },

  findPurchaseDetail(id: string, tenantId: string) {
    return prisma.purchase.findFirst({
      where: { id, tenantId },
      include: {
        supplier: true,
        branch: { select: { name: true } },
        items: true,
        returns: { include: { items: true } },
      },
    });
  },
};
