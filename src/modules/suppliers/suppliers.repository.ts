import { prisma } from "../../lib/prisma.js";

/** Data-access for suppliers. No business rules here. */
export const suppliersRepository = {
  list(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.supplier.findMany({
      where: opts.where as never,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        taxId: true,
        creditDue: true,
        status: true,
        createdAt: true,
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  count(where: Record<string, unknown>) {
    return prisma.supplier.count({ where: where as never });
  },

  findById(tenantId: string, id: string) {
    return prisma.supplier.findFirst({ where: { id, tenantId } });
  },

  findDetail(tenantId: string, id: string) {
    return prisma.supplier.findFirst({
      where: { id, tenantId },
      include: {
        purchases: { orderBy: { createdAt: "desc" }, take: 50, include: { items: true } },
        purchaseOrders: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
  },

  listPayments(tenantId: string, supplierId: string) {
    return prisma.ledgerPayment.findMany({
      where: { tenantId, partyType: "SUPPLIER", partyId: supplierId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  },

  create(tenantId: string, data: { name: string; phone?: string; email?: string; address?: string; taxId?: string; notes?: string }) {
    return prisma.supplier.create({ data: { tenantId, ...data } });
  },

  update(id: string, data: Record<string, unknown>) {
    return prisma.supplier.update({ where: { id }, data: data as never });
  },

  countPurchases(supplierId: string) {
    return prisma.purchase.count({ where: { supplierId } });
  },

  countPurchaseOrders(supplierId: string) {
    return prisma.purchaseOrder.count({ where: { supplierId } });
  },

  remove(id: string) {
    return prisma.supplier.delete({ where: { id } });
  },
};
