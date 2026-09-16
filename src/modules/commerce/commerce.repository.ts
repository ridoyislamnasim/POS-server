import { prisma } from "../../lib/prisma.js";

/** Data-access for commerce (sales orders/ecommerce/deliveries). No business rules here. */
export const commerceRepository = {
  listSalesOrders(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.salesOrder.findMany({
      where: opts.where as never,
      select: {
        id: true,
        number: true,
        total: true,
        status: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
        branch: { select: { name: true } },
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countSalesOrders(where: Record<string, unknown>) {
    return prisma.salesOrder.count({ where: where as never });
  },

  findVariant(tenantId: string, variantId: string) {
    return prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      include: { product: true },
    });
  },

  createSalesOrder(data: Parameters<typeof prisma.salesOrder.create>[0]["data"]) {
    return prisma.salesOrder.create({ data, include: { items: true, customer: true } });
  },

  findSalesOrder(tenantId: string, id: string) {
    return prisma.salesOrder.findFirst({ where: { id, tenantId } });
  },

  updateSalesOrder(id: string, data: { status?: unknown; notes?: string }) {
    return prisma.salesOrder.update({
      where: { id },
      data: data as never,
      include: { items: true, customer: true },
    });
  },

  listEcommerceOrders(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.ecommerceOrder.findMany({
      where: opts.where as never,
      select: {
        id: true,
        channel: true,
        externalId: true,
        status: true,
        total: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countEcommerceOrders(where: Record<string, unknown>) {
    return prisma.ecommerceOrder.count({ where: where as never });
  },

  upsertEcommerceOrder(
    tenantId: string,
    channel: string,
    externalId: string,
    create: Record<string, unknown>,
    update: Record<string, unknown>,
  ) {
    return prisma.ecommerceOrder.upsert({
      where: { tenantId_channel_externalId: { tenantId, channel, externalId } },
      create: { tenantId, channel, externalId, ...(create as object) } as never,
      update: update as never,
      include: { customer: true },
    });
  },

  findEcommerceOrder(tenantId: string, id: string) {
    return prisma.ecommerceOrder.findFirst({ where: { id, tenantId } });
  },

  deleteEcommerceOrder(id: string) {
    return prisma.ecommerceOrder.delete({ where: { id } });
  },

  listDeliveries(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.delivery.findMany({
      where: opts.where as never,
      select: {
        id: true,
        status: true,
        address: true,
        phone: true,
        courier: true,
        tracking: true,
        createdAt: true,
        branch: { select: { name: true } },
        salesOrder: { select: { number: true } },
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countDeliveries(where: Record<string, unknown>) {
    return prisma.delivery.count({ where: where as never });
  },

  createDelivery(data: Parameters<typeof prisma.delivery.create>[0]["data"]) {
    return prisma.delivery.create({ data });
  },

  findDelivery(tenantId: string, id: string) {
    return prisma.delivery.findFirst({ where: { id, tenantId } });
  },

  updateDelivery(id: string, data: Record<string, unknown>) {
    return prisma.delivery.update({ where: { id }, data: data as never });
  },

  deleteDelivery(id: string) {
    return prisma.delivery.delete({ where: { id } });
  },
};
