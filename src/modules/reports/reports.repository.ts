import { prisma } from "../../lib/prisma.js";

/** Data-access for read-only reports. No formatting/business rules here. */
export const reportsRepository = {
  salesAggregate(where: Record<string, unknown>) {
    return prisma.sale.aggregate({
      where: where as never,
      _sum: { total: true, paid: true, due: true, tax: true },
      _count: true,
    });
  },

  salesRows(opts: { where: Record<string, unknown>; skip: number; take: number }) {
    return prisma.sale.findMany({
      where: opts.where as never,
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        paid: true,
        due: true,
        tax: true,
        createdAt: true,
        status: true,
        cashierId: true,
        branch: { select: { name: true } },
        customer: { select: { name: true } },
        payments: { select: { method: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
    });
  },

  purchasesAggregate(where: Record<string, unknown>) {
    return prisma.purchase.aggregate({ where: where as never, _sum: { total: true, due: true }, _count: true });
  },

  purchasesRows(opts: { where: Record<string, unknown>; skip: number; take: number }) {
    return prisma.purchase.findMany({
      where: opts.where as never,
      select: {
        id: true,
        invoiceNumber: true,
        total: true,
        due: true,
        status: true,
        createdAt: true,
        supplier: { select: { name: true } },
        branch: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
    });
  },

  stockCount(where: Record<string, unknown>) {
    return prisma.stock.count({ where: where as never });
  },

  stockRows(opts: { where: Record<string, unknown>; skip: number; take: number }) {
    return prisma.stock.findMany({
      where: opts.where as never,
      include: {
        variant: { include: { product: { select: { name: true } } } },
        location: { select: { name: true } },
      },
      skip: opts.skip,
      take: opts.take,
      orderBy: { variant: { sku: "asc" } },
    });
  },

  stockValue(tenantId: string) {
    return prisma.$queryRaw<[{ value: string | null; available: string | null; damaged: string | null }]>`
      SELECT
        COALESCE(SUM(s.quantity * COALESCE(NULLIF(s."unitCost", 0), v.cost, 0)), 0)::text AS value,
        COALESCE(SUM((s.quantity - s."reservedQuantity") * COALESCE(NULLIF(s."unitCost", 0), v.cost, 0)), 0)::text AS available,
        COALESCE(SUM(s."damagedQuantity" * COALESCE(NULLIF(s."unitCost", 0), v.cost, 0)), 0)::text AS damaged
      FROM "Stock" s
      JOIN "ProductVariant" v ON v.id = s."variantId"
      WHERE s."tenantId" = ${tenantId}
    `;
  },

  salesWithItems(where: Record<string, unknown>) {
    return prisma.sale.findMany({ where: where as never, include: { items: true } });
  },

  expenseTotal(where: Record<string, unknown>) {
    return prisma.expense.aggregate({ where: where as never, _sum: { amount: true } });
  },

  variantCosts(variantIds: string[]) {
    return prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, cost: true } });
  },

  variantCostsForTenant(tenantId: string, variantIds: string[]) {
    return prisma.productVariant.findMany({
      where: { tenantId, id: { in: variantIds } },
      select: { id: true, cost: true },
    });
  },

  expensesAggregate(where: Record<string, unknown>) {
    return prisma.expense.aggregate({ where: where as never, _sum: { amount: true }, _count: true });
  },

  expensesRows(opts: { where: Record<string, unknown>; skip: number; take: number }) {
    return prisma.expense.findMany({
      where: opts.where as never,
      include: { category: { select: { name: true } }, branch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
    });
  },

  customerDueTotal(tenantId: string) {
    return prisma.customer.aggregate({
      where: { tenantId, creditDue: { gt: 0 } },
      _sum: { creditDue: true },
    });
  },

  supplierDueTotal(tenantId: string) {
    return prisma.supplier.aggregate({
      where: { tenantId, creditDue: { gt: 0 } },
      _sum: { creditDue: true },
    });
  },

  customersWithDue(opts: { where: Record<string, unknown>; skip: number; take: number }) {
    return prisma.customer.findMany({
      where: opts.where as never,
      select: { id: true, name: true, phone: true, creditDue: true },
      orderBy: { creditDue: "desc" },
      skip: opts.skip,
      take: opts.take,
    });
  },

  countCustomers(where: Record<string, unknown>) {
    return prisma.customer.count({ where: where as never });
  },

  salesTax(where: Record<string, unknown>) {
    return prisma.sale.aggregate({ where: where as never, _sum: { tax: true }, _count: true });
  },

  purchaseTax(where: Record<string, unknown>) {
    return prisma.purchase.aggregate({ where: where as never, _sum: { tax: true }, _count: true });
  },

  salesByCashier(where: Record<string, unknown>) {
    return prisma.sale.groupBy({
      by: ["cashierId"],
      where: where as never,
      _sum: { total: true },
      _count: true,
    });
  },

  usersByIds(ids: string[]) {
    return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  },

  salesItemsGrouped(where: Record<string, unknown>) {
    return prisma.saleItem.groupBy({
      by: ["variantId", "skuSnapshot", "productNameSnapshot"],
      where: where as never,
      _sum: { qty: true, lineTotal: true },
    });
  },

  saleReturnsAggregate(where: Record<string, unknown>) {
    return prisma.saleReturn.aggregate({
      where: where as never,
      _sum: { refundedAmount: true },
      _count: true,
    });
  },

  saleReturnItemsAggregate(where: Record<string, unknown>) {
    return prisma.saleReturnItem.aggregate({ where: where as never, _sum: { qty: true, lineRefund: true } });
  },

  countSaleReturns(where: Record<string, unknown>) {
    return prisma.saleReturn.count({ where: where as never });
  },

  saleReturnRows(opts: { where: Record<string, unknown>; skip: number; take: number }) {
    return prisma.saleReturn.findMany({
      where: opts.where as never,
      include: {
        items: { select: { qty: true, lineRefund: true } },
        sale: { select: { invoiceNumber: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
    });
  },

  receiptsAggregate(where: Record<string, unknown>) {
    return prisma.stockReceipt.aggregate({
      where: where as never,
      _sum: { totalQty: true, totalCost: true },
      _count: true,
    });
  },

  countReceipts(where: Record<string, unknown>) {
    return prisma.stockReceipt.count({ where: where as never });
  },

  receiptRows(opts: { where: Record<string, unknown>; skip: number; take: number }) {
    return prisma.stockReceipt.findMany({
      where: opts.where as never,
      select: {
        number: true,
        kind: true,
        totalQty: true,
        totalCost: true,
        status: true,
        supplier: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
    });
  },

  damagesAggregate(where: Record<string, unknown>) {
    return prisma.stockDamage.aggregate({
      where: where as never,
      _sum: { totalQty: true, totalCost: true },
      _count: true,
    });
  },

  countDamages(where: Record<string, unknown>) {
    return prisma.stockDamage.count({ where: where as never });
  },

  damageRows(opts: { where: Record<string, unknown>; skip: number; take: number }) {
    return prisma.stockDamage.findMany({
      where: opts.where as never,
      select: { number: true, reason: true, status: true, totalQty: true, totalCost: true },
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
    });
  },
};
