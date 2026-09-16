import { branchScope, money, num, tenantId } from "../../lib/erp.js";
import { paginationMeta, parseListQuery } from "../../lib/list-query.js";
import type { RequestContext } from "../../types.js";
import { reportsRepository } from "./reports.repository.js";
import type { ReportRange } from "./reports.types.js";

function range(ctx: RequestContext, query: Record<string, unknown>): ReportRange {
  const from = String(query.from ?? ctx.businessDate);
  const to = String(query.to ?? ctx.businessDate);
  return { from, to, gte: new Date(from), lte: new Date(to) };
}

/**
 * Read-only reporting logic. No Express `req`/`res` here.
 * All queries stay tenant-scoped (plus branch scope where the
 * pre-refactor routes applied it).
 */
export const reportsService = {
  async sales(ctx: RequestContext, query: Record<string, unknown>) {
    const r = range(ctx, query);
    const list = parseListQuery(query, {
      sortable: ["createdAt", "total", "invoiceNumber"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      businessDate: { gte: r.gte, lte: r.lte },
      ...(q
        ? {
            OR: [
              { invoiceNumber: { contains: q, mode: "insensitive" as const } },
              { customer: { name: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
    const [agg, rows] = await Promise.all([
      reportsRepository.salesAggregate(where),
      reportsRepository.salesRows({ where, skip: list.skip, take: list.take }),
    ]);
    return {
      body: {
        from: r.from,
        to: r.to,
        total: money(num(agg._sum.total)),
        count: agg._count,
        rows: rows.map((s) => ({
          id: s.id,
          invoice: s.invoiceNumber,
          branch: s.branch.name,
          customer: s.customer?.name ?? "Walk-in",
          total: money(num(s.total)),
          paid: money(num(s.paid)),
          due: money(num(s.due)),
          tax: money(num(s.tax)),
          method: s.payments.map((p) => p.method).join("+"),
          cashierId: s.cashierId,
          time: s.createdAt,
          status: s.status,
        })),
      },
      pagination: paginationMeta(agg._count, list.page, list.limit),
    };
  },

  async purchases(ctx: RequestContext, query: Record<string, unknown>) {
    const r = range(ctx, query);
    const list = parseListQuery(query, {
      sortable: ["createdAt", "total"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const where = { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte } };
    const [agg, rows] = await Promise.all([
      reportsRepository.purchasesAggregate(where),
      reportsRepository.purchasesRows({ where, skip: list.skip, take: list.take }),
    ]);
    return {
      body: {
        from: r.from,
        to: r.to,
        total: money(num(agg._sum.total)),
        due: money(num(agg._sum.due)),
        rows: rows.map((p) => ({
          id: p.id,
          invoice: p.invoiceNumber,
          supplier: p.supplier.name,
          branch: p.branch.name,
          total: money(num(p.total)),
          due: money(num(p.due)),
          status: p.status,
        })),
      },
      pagination: paginationMeta(agg._count, list.page, list.limit),
    };
  },

  async inventory(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, { sortable: ["sku"], defaultSort: "sku", defaultOrder: "asc" });
    const q = list.search;
    const tid = tenantId(ctx);
    const where = {
      tenantId: tid,
      ...(q
        ? {
            OR: [
              { variant: { sku: { contains: q, mode: "insensitive" as const } } },
              { variant: { product: { name: { contains: q, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
    };
    const [total, rows, valueAgg] = await Promise.all([
      reportsRepository.stockCount(where),
      reportsRepository.stockRows({ where, skip: list.skip, take: list.take }),
      reportsRepository.stockValue(tid),
    ]);
    return {
      body: {
        stockValue: money(num(valueAgg[0]?.value)),
        availableValue: money(num(valueAgg[0]?.available)),
        damagedValue: money(num(valueAgg[0]?.damaged)),
        rows: rows.map((s) => ({
          sku: s.variant.sku,
          product: s.variant.product.name,
          location: s.location.name,
          available: money(num(s.quantity) - num(s.reservedQuantity)),
          reserved: money(num(s.reservedQuantity)),
          damaged: money(num(s.damagedQuantity)),
          quarantine: money(num(s.quarantineQuantity)),
          physical: money(num(s.quantity) + num(s.damagedQuantity) + num(s.quarantineQuantity)),
          cost: money(num(s.variant.cost)),
          value: money((num(s.quantity) - num(s.reservedQuantity)) * num(s.variant.cost)),
        })),
      },
      pagination: paginationMeta(total, list.page, list.limit),
    };
  },

  async profit(ctx: RequestContext, query: Record<string, unknown>) {
    const r = range(ctx, query);
    const sales = await reportsRepository.salesWithItems({
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      businessDate: { gte: r.gte, lte: r.lte },
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
    });
    const expenses = await reportsRepository.expenseTotal({
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      businessDate: { gte: r.gte, lte: r.lte },
      status: "POSTED",
    });
    const variantIds = [...new Set(sales.flatMap((s) => s.items.map((i) => i.variantId)))];
    const costs = await reportsRepository.variantCosts(variantIds);
    const costMap = new Map(costs.map((c) => [c.id, num(c.cost)]));
    let cogs = 0;
    for (const s of sales) for (const i of s.items) cogs += num(i.qty) * (costMap.get(i.variantId) ?? 0);
    const revenue = sales.reduce((n, s) => n + num(s.total), 0);
    return {
      from: r.from,
      to: r.to,
      revenue: money(revenue),
      cogs: money(cogs),
      gross: money(revenue - cogs),
      expenses: money(num(expenses._sum.amount)),
      net: money(revenue - cogs - num(expenses._sum.amount)),
    };
  },

  async expenses(ctx: RequestContext, query: Record<string, unknown>) {
    const r = range(ctx, query);
    const list = parseListQuery(query, {
      sortable: ["createdAt", "amount"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const where = { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte } };
    const [agg, rows] = await Promise.all([
      reportsRepository.expensesAggregate(where),
      reportsRepository.expensesRows({ where, skip: list.skip, take: list.take }),
    ]);
    return {
      body: {
        from: r.from,
        to: r.to,
        total: money(num(agg._sum.amount)),
        rows: rows.map((e) => ({
          id: e.id,
          category: e.category.name,
          vendor: e.vendor,
          amount: money(num(e.amount)),
          method: e.method,
          branch: e.branch?.name,
          date: e.businessDate,
        })),
      },
      pagination: paginationMeta(agg._count, list.page, list.limit),
    };
  },

  async dues(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["creditDue", "name"],
      defaultSort: "creditDue",
      defaultOrder: "desc",
    });
    const q = list.search;
    const customerWhere = {
      tenantId: tenantId(ctx),
      creditDue: { gt: 0 },
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    };
    const [customerDue, customers, customerCount, suppliers] = await Promise.all([
      reportsRepository.customerDueTotal(tenantId(ctx)),
      reportsRepository.customersWithDue({ where: customerWhere, skip: list.skip, take: list.take }),
      reportsRepository.countCustomers(customerWhere),
      reportsRepository.supplierDueTotal(tenantId(ctx)),
    ]);
    return {
      body: {
        customerDue: money(num(customerDue._sum.creditDue)),
        supplierDue: money(num(suppliers._sum.creditDue)),
        customers,
        rows: customers,
      },
      pagination: paginationMeta(customerCount, list.page, list.limit),
    };
  },

  async tax(ctx: RequestContext, query: Record<string, unknown>) {
    const r = range(ctx, query);
    const saleWhere = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      businessDate: { gte: r.gte, lte: r.lte },
    };
    const [sales, purchases] = await Promise.all([
      reportsRepository.salesTax(saleWhere),
      reportsRepository.purchaseTax(saleWhere),
    ]);
    const output = num(sales._sum.tax);
    const input = num(purchases._sum.tax);
    return {
      from: r.from,
      to: r.to,
      outputVat: money(output),
      inputVat: money(input),
      payable: money(output - input),
      salesCount: sales._count,
      purchaseCount: purchases._count,
    };
  },

  async cashier(ctx: RequestContext, query: Record<string, unknown>) {
    const r = range(ctx, query);
    const list = parseListQuery(query, { defaultLimit: 25 });
    const grouped = await reportsRepository.salesByCashier({
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      businessDate: { gte: r.gte, lte: r.lte },
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
    });
    grouped.sort((a, b) => num(b._sum.total) - num(a._sum.total));
    const pageSlice = grouped.slice(list.skip, list.skip + list.take);
    const users = await reportsRepository.usersByIds(pageSlice.map((g) => g.cashierId));
    const names = new Map(users.map((u) => [u.id, u.name]));
    return {
      body: pageSlice.map((g) => ({
        cashierId: g.cashierId,
        name: names.get(g.cashierId) ?? g.cashierId,
        count: g._count,
        total: money(num(g._sum.total)),
      })),
      pagination: paginationMeta(grouped.length, list.page, list.limit),
    };
  },

  async products(ctx: RequestContext, query: Record<string, unknown>) {
    const r = range(ctx, query);
    const list = parseListQuery(query, { defaultLimit: 25 });
    const grouped = await reportsRepository.salesItemsGrouped({
      sale: {
        tenantId: tenantId(ctx),
        ...branchScope(ctx),
        businessDate: { gte: r.gte, lte: r.lte },
        status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      },
    });
    grouped.sort((a, b) => num(b._sum.lineTotal) - num(a._sum.lineTotal));
    const pageSlice = grouped.slice(list.skip, list.skip + list.take);
    return {
      body: pageSlice.map((g) => ({
        sku: g.skuSnapshot,
        name: g.productNameSnapshot,
        qty: money(num(g._sum.qty)),
        revenue: money(num(g._sum.lineTotal)),
      })),
      pagination: paginationMeta(grouped.length, list.page, list.limit),
    };
  },

  async returns(ctx: RequestContext, query: Record<string, unknown>) {
    const r = range(ctx, query);
    const list = parseListQuery(query, {
      sortable: ["createdAt", "number"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const q = list.search;
    const postedWhere = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      createdAt: { gte: r.gte, lte: r.lte },
      status: { in: ["APPROVED" as const, "COMPLETED" as const] },
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" as const } },
              { sale: { invoiceNumber: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
    const [kpi, itemKpi, count, rows] = await Promise.all([
      reportsRepository.saleReturnsAggregate(postedWhere),
      reportsRepository.saleReturnItemsAggregate({ saleReturn: postedWhere }),
      reportsRepository.countSaleReturns(postedWhere),
      reportsRepository.saleReturnRows({ where: postedWhere, skip: list.skip, take: list.take }),
    ]);
    return {
      body: {
        from: r.from,
        to: r.to,
        count: kpi._count,
        returnedQty: money(num(itemKpi._sum.qty)),
        returnValue: money(num(itemKpi._sum.lineRefund)),
        refundAmount: money(num(kpi._sum.refundedAmount)),
        rows: rows.map((x) => ({
          number: x.number,
          invoice: x.sale.invoiceNumber,
          status: x.status,
          refundStatus: x.refundStatus,
          qty: money(x.items.reduce((a, i) => a + num(i.qty), 0)),
          refund: money(num(x.refundedAmount)),
          reason: x.reason,
        })),
      },
      pagination: paginationMeta(count, list.page, list.limit),
    };
  },

  async receiving(ctx: RequestContext, query: Record<string, unknown>) {
    const r = range(ctx, query);
    const list = parseListQuery(query, {
      sortable: ["createdAt", "number"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      status: "RECEIVED" as const,
      createdAt: { gte: r.gte, lte: r.lte },
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" as const } },
              { supplier: { name: { contains: q, mode: "insensitive" as const } } },
            ],
          }
        : {}),
    };
    const [kpi, count, rows] = await Promise.all([
      reportsRepository.receiptsAggregate(where),
      reportsRepository.countReceipts(where),
      reportsRepository.receiptRows({ where, skip: list.skip, take: list.take }),
    ]);
    return {
      body: {
        from: r.from,
        to: r.to,
        count: kpi._count,
        receivedQty: money(num(kpi._sum.totalQty)),
        receivedValue: money(num(kpi._sum.totalCost)),
        rows: rows.map((x) => ({
          number: x.number,
          kind: x.kind,
          supplier: x.supplier?.name ?? "—",
          qty: money(num(x.totalQty)),
          value: money(num(x.totalCost)),
          status: x.status,
        })),
      },
      pagination: paginationMeta(count, list.page, list.limit),
    };
  },

  async damage(ctx: RequestContext, query: Record<string, unknown>) {
    const r = range(ctx, query);
    const list = parseListQuery(query, {
      sortable: ["createdAt", "number"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      createdAt: { gte: r.gte, lte: r.lte },
      status: { in: ["STOCK_ADJUSTED" as const, "APPROVED" as const] },
      ...(q
        ? {
            OR: [
              { number: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };
    const [kpi, count, rows] = await Promise.all([
      reportsRepository.damagesAggregate(where),
      reportsRepository.countDamages(where),
      reportsRepository.damageRows({ where, skip: list.skip, take: list.take }),
    ]);
    return {
      body: {
        from: r.from,
        to: r.to,
        count: kpi._count,
        damagedQty: money(num(kpi._sum.totalQty)),
        damageCost: money(num(kpi._sum.totalCost)),
        rows: rows.map((x) => ({
          number: x.number,
          reason: x.reason,
          status: x.status,
          qty: money(num(x.totalQty)),
          cost: money(num(x.totalCost)),
        })),
      },
      pagination: paginationMeta(count, list.page, list.limit),
    };
  },
};
