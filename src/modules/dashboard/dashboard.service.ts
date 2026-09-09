import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/scope.js";
import { stockRepository } from "../inventory/stock.repository.js";
import type { RequestContext } from "../../types.js";

const LOW_STOCK = 5;

function addDays(isoDate: string, days: number) {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function monthStart(isoDate: string) {
  return `${isoDate.slice(0, 8)}01`;
}

export function periodRange(period: string, businessDate: string) {
  const today = businessDate;
  if (period === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
  if (period === "week") return { from: addDays(today, -6), to: today };
  if (period === "month") return { from: monthStart(today), to: today };
  return { from: today, to: today };
}

function saleScope(ctx: RequestContext) {
  const tenantId = requireTenantId(ctx);
  return {
    tenantId,
    ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
  };
}

function money(n: number) {
  return n.toFixed(2);
}

export async function dashboardSummary(ctx: RequestContext, from: string, to: string) {
  const where = { ...saleScope(ctx), businessDate: { gte: new Date(from), lte: new Date(to) } };
  const completed = {
    ...where,
    status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] as Array<
      "COMPLETED" | "PARTIALLY_RETURNED" | "FULLY_RETURNED"
    > },
  };

  const [sales, returned, branches, allowedLocs] = await Promise.all([
    prisma.sale.findMany({
      where: completed,
      include: { items: true, payments: true },
    }),
    prisma.sale.findMany({
      where: { ...where, status: { in: ["PARTIALLY_RETURNED", "FULLY_RETURNED"] } },
      select: { id: true, total: true },
    }),
    prisma.branch.findMany({
      where: {
        tenantId: ctx.tenantId!,
        operationalStatus: "OPEN",
        ...(ctx.allBranches || ctx.isPlatform ? {} : { id: { in: ctx.branchIds } }),
      },
      select: { id: true },
    }),
    stockRepository.allowedLocationIds(ctx),
  ]);

  const stockRows = await prisma.stock.findMany({
    where: { tenantId: ctx.tenantId!, locationId: { in: [...allowedLocs] } },
    include: { variant: { select: { cost: true } } },
  });

  let stockValue = 0;
  let lowStockItems = 0;
  for (const row of stockRows) {
    const qty = Number(row.quantity);
    const reserved = Number(row.reservedQuantity ?? 0);
    const available = qty - reserved;
    stockValue += qty * Number(row.variant.cost);
    if (available <= LOW_STOCK) lowStockItems += 1;
  }

  const todayCustomers = new Set(sales.map((s) => s.customerId).filter(Boolean)).size;
  let profit = 0;
  const variantIds = [...new Set(sales.flatMap((s) => s.items.map((i) => i.variantId)))];
  const costs = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, tenantId: ctx.tenantId! },
    select: { id: true, cost: true },
  });
  const costMap = new Map(costs.map((c) => [c.id, Number(c.cost)]));
  for (const sale of sales) {
    for (const item of sale.items) {
      profit += Number(item.lineTotal) - Number(item.qty) * (costMap.get(item.variantId) ?? 0);
    }
  }

  const refunds = sales
    .flatMap((s) => s.payments)
    .filter((p) => p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED")
    .reduce((n, p) => n + Number(p.amount), 0);

  const expenseSum = await prisma.expense.aggregate({
    where: { tenantId: ctx.tenantId!, businessDate: { gte: new Date(from), lte: new Date(to) }, status: "POSTED" },
    _sum: { amount: true },
  });
  const customerDue = await prisma.customer.aggregate({
    where: { tenantId: ctx.tenantId! },
    _sum: { creditDue: true },
  });
  const supplierDue = await prisma.supplier.aggregate({
    where: { tenantId: ctx.tenantId! },
    _sum: { creditDue: true },
  });
  const orders = sales.length;
  const revenue = sales.reduce((n, s) => n + Number(s.total), 0);
  const expenses = Number(expenseSum._sum.amount ?? 0);

  return {
    from,
    to,
    todaysSales: money(revenue),
    todaysTransactions: orders,
    orders,
    revenue: money(revenue),
    todaysCustomers: todayCustomers,
    todaysReturns: returned.length,
    todaysReturnAmount: money(refunds),
    todaysProfit: money(profit),
    profit: money(profit),
    expenses: money(expenses),
    due: money(Number(customerDue._sum.creditDue ?? 0)),
    customerDue: money(Number(customerDue._sum.creditDue ?? 0)),
    supplierDue: money(Number(supplierDue._sum.creditDue ?? 0)),
    grossMargin: money(revenue === 0 ? 0 : (profit / revenue) * 100),
    currentStockValue: money(stockValue),
    lowStockItems,
    activeOutlets: branches.length,
  };
}

export async function dashboardSales(ctx: RequestContext, period: string) {
  const { from, to } = periodRange(period, ctx.businessDate);
  const sales = await prisma.sale.findMany({
    where: {
      ...saleScope(ctx),
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] },
      businessDate: { gte: new Date(from), lte: new Date(to) },
    },
    include: { payments: true },
  });

  const byMethod: Record<string, number> = { CASH: 0, CARD: 0, MFS: 0 };
  let refunds = 0;
  let discounts = 0;
  const buckets = new Map<string, { sales: number; count: number }>();

  for (const sale of sales) {
    discounts += Number(sale.discount);
    const key = sale.businessDate.toISOString().slice(0, 10);
    const bucket = buckets.get(key) ?? { sales: 0, count: 0 };
    bucket.sales += Number(sale.total);
    bucket.count += 1;
    buckets.set(key, bucket);
    for (const p of sale.payments) {
      if (p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED") {
        refunds += Number(p.amount);
        continue;
      }
      if (p.status !== "CAPTURED") continue;
      const method = p.method.toUpperCase();
      if (method === "CASH" || method === "CARD" || method === "MFS") {
        byMethod[method] += Number(p.amount);
      } else {
        byMethod[method] = (byMethod[method] ?? 0) + Number(p.amount);
      }
    }
  }

  const total = sales.reduce((n, s) => n + Number(s.total), 0);
  const series: { date: string; sales: number; count: number }[] = [];
  let cursor = from;
  while (cursor <= to) {
    const b = buckets.get(cursor) ?? { sales: 0, count: 0 };
    series.push({ date: cursor, sales: Number(b.sales.toFixed(2)), count: b.count });
    cursor = addDays(cursor, 1);
  }

  return {
    period,
    from,
    to,
    totalSales: money(total),
    transactionCount: sales.length,
    averageTransactionValue: money(sales.length ? total / sales.length : 0),
    cash: money(byMethod.CASH),
    card: money(byMethod.CARD),
    mfs: money(byMethod.MFS),
    refunds: money(refunds),
    discounts: money(discounts),
    payments: Object.entries(byMethod).map(([method, amount]) => ({ method, amount: money(amount) })),
    series,
  };
}

export async function dashboardInventory(ctx: RequestContext) {
  const allowed = await stockRepository.allowedLocationIds(ctx);
  const rows = await prisma.stock.findMany({
    where: { tenantId: ctx.tenantId!, locationId: { in: [...allowed] } },
    include: {
      variant: { include: { product: { select: { name: true, code: true } } } },
      location: { select: { id: true, name: true } },
    },
  });
  let stockValue = 0;
  const low: typeof rows = [];
  const out: typeof rows = [];
  for (const row of rows) {
    const available = Number(row.quantity) - Number(row.reservedQuantity ?? 0);
    stockValue += Number(row.quantity) * Number(row.variant.cost);
    if (available <= 0) out.push(row);
    else if (available <= LOW_STOCK) low.push(row);
  }
  return {
    stockValue: money(stockValue),
    lowStockCount: low.length,
    outOfStockCount: out.length,
    lowStock: low.slice(0, 20).map(mapStockLine),
    outOfStock: out.slice(0, 20).map(mapStockLine),
  };
}

function mapStockLine(row: {
  quantity: { toString(): string };
  reservedQuantity?: { toString(): string } | null;
  variant: { sku: string; cost: { toString(): string }; product: { name: string; code: string } };
  location: { id: string; name: string };
}) {
  const qty = Number(row.quantity);
  const reserved = Number(row.reservedQuantity ?? 0);
  return {
    sku: row.variant.sku,
    product: row.variant.product.name,
    code: row.variant.product.code,
    location: row.location.name,
    available: money(qty - reserved),
    reserved: money(reserved),
    cost: money(Number(row.variant.cost)),
    stockValue: money(qty * Number(row.variant.cost)),
  };
}

export async function dashboardCustomers(ctx: RequestContext, from: string, to: string) {
  const sales = await prisma.sale.findMany({
    where: {
      ...saleScope(ctx),
      businessDate: { gte: new Date(from), lte: new Date(to) },
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] },
    },
    select: { customerId: true },
  });
  const withCustomer = sales.filter((s) => s.customerId);
  return {
    from,
    to,
    customersWithSales: new Set(withCustomer.map((s) => s.customerId)).size,
    walkInTransactions: sales.length - withCustomer.length,
    transactions: sales.length,
  };
}

export async function dashboardReturns(ctx: RequestContext, from: string, to: string) {
  const rows = await prisma.sale.findMany({
    where: {
      ...saleScope(ctx),
      businessDate: { gte: new Date(from), lte: new Date(to) },
      status: { in: ["PARTIALLY_RETURNED", "FULLY_RETURNED"] },
    },
    select: { id: true, total: true, invoiceNumber: true },
  });
  const refunds = await prisma.paymentTransaction.aggregate({
    where: {
      status: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] },
      sale: saleScope(ctx),
    },
    _sum: { amount: true },
    _count: true,
  });
  return {
    from,
    to,
    count: rows.length,
    amount: money(Number(refunds._sum.amount ?? 0)),
    refundPayments: refunds._count,
  };
}

export async function dashboardTopProducts(ctx: RequestContext, from: string, to: string) {
  const items = await prisma.saleItem.findMany({
    where: {
      sale: {
        ...saleScope(ctx),
        businessDate: { gte: new Date(from), lte: new Date(to) },
        status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] },
      },
    },
    select: {
      variantId: true,
      qty: true,
      lineTotal: true,
      productNameSnapshot: true,
      skuSnapshot: true,
    },
  });
  const map = new Map<
    string,
    { variantId: string; name: string; sku: string; qty: number; revenue: number }
  >();
  for (const item of items) {
    const cur = map.get(item.variantId) ?? {
      variantId: item.variantId,
      name: item.productNameSnapshot,
      sku: item.skuSnapshot,
      qty: 0,
      revenue: 0,
    };
    cur.qty += Number(item.qty);
    cur.revenue += Number(item.lineTotal);
    map.set(item.variantId, cur);
  }
  return [...map.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((r) => ({ ...r, qty: money(r.qty), revenue: money(r.revenue) }));
}

export async function dashboardRecentSales(ctx: RequestContext) {
  const sales = await prisma.sale.findMany({
    where: saleScope(ctx),
    orderBy: { createdAt: "desc" },
    take: 15,
    include: { payments: true, branch: true, customer: true },
  });
  const cashierIds = [...new Set(sales.map((s) => s.cashierId))];
  const cashiers = await prisma.user.findMany({
    where: { id: { in: cashierIds } },
    select: { id: true, name: true },
  });
  const names = new Map(cashiers.map((c) => [c.id, c.name]));
  return sales.map((s) => ({
    id: s.id,
    invoiceNumber: s.invoiceNumber,
    customer: s.customer?.name ?? (s.customerSnapshot as { name?: string } | null)?.name ?? "Walk-in",
    cashier: names.get(s.cashierId) ?? s.cashierId,
    outlet: s.branch.name,
    amount: money(Number(s.total)),
    payment: s.payments.map((p) => p.method).join("+") || "—",
    time: s.createdAt.toISOString(),
    status: s.status,
  }));
}

export async function dashboardTopCustomers(ctx: RequestContext, from: string, to: string) {
  const sales = await prisma.sale.findMany({
    where: {
      ...saleScope(ctx),
      businessDate: { gte: new Date(from), lte: new Date(to) },
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] },
      customerId: { not: null },
    },
    include: { customer: true },
  });
  const map = new Map<string, { id: string; name: string; phone: string; count: number; revenue: number }>();
  for (const s of sales) {
    if (!s.customer) continue;
    const cur = map.get(s.customer.id) ?? {
      id: s.customer.id,
      name: s.customer.name,
      phone: s.customer.phone,
      count: 0,
      revenue: 0,
    };
    cur.count += 1;
    cur.revenue += Number(s.total);
    map.set(s.customer.id, cur);
  }
  return [...map.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10)
    .map((r) => ({ ...r, revenue: money(r.revenue) }));
}

export async function dashboardByCashier(ctx: RequestContext, from: string, to: string) {
  const sales = await prisma.sale.findMany({
    where: {
      ...saleScope(ctx),
      businessDate: { gte: new Date(from), lte: new Date(to) },
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
    },
  });
  const ids = [...new Set(sales.map((s) => s.cashierId))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const map = new Map<string, { cashier: string; count: number; total: number }>();
  for (const s of sales) {
    const cur = map.get(s.cashierId) ?? { cashier: names.get(s.cashierId) ?? s.cashierId, count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(s.total);
    map.set(s.cashierId, cur);
  }
  return [...map.values()].map((r) => ({ ...r, total: money(r.total) }));
}

export async function dashboardHourly(ctx: RequestContext, from: string, to: string) {
  const sales = await prisma.sale.findMany({
    where: {
      ...saleScope(ctx),
      businessDate: { gte: new Date(from), lte: new Date(to) },
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
    },
  });
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: String(h).padStart(2, "0"), sales: 0, count: 0 }));
  for (const s of sales) {
    const h = s.createdAt.getHours();
    hours[h].sales += Number(s.total);
    hours[h].count += 1;
  }
  return hours.map((h) => ({ ...h, sales: Number(h.sales.toFixed(2)) }));
}

export async function dashboardRecentActivity(ctx: RequestContext) {
  const tenantId = requireTenantId(ctx);
  const rows = await prisma.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: 15,
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    time: r.createdAt.toISOString(),
  }));
}
