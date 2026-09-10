import { Prisma, type SaleStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { requireTenantId } from "../../lib/scope.js";
import { branchScope, money, num } from "../../lib/erp.js";
import { stockRepository } from "../inventory/stock.repository.js";
import type { RequestContext } from "../../types.js";

const LOW_STOCK_FALLBACK = 5;
const TOP_LIMIT = 8;
const RECENT_LIMIT = 8;
const ACTIVITY_LIMIT = 10;

const COMPLETED: SaleStatus[] = ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"];
const SQL_SALE_DONE = Prisma.sql`s.status IN ('COMPLETED', 'PARTIALLY_RETURNED', 'FULLY_RETURNED')`;

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
  return { tenantId: requireTenantId(ctx), ...branchScope(ctx) };
}

function dateRange(from: string, to: string) {
  return { gte: new Date(from), lte: new Date(to) };
}

function completedWhere(ctx: RequestContext, from: string, to: string) {
  return {
    ...saleScope(ctx),
    businessDate: dateRange(from, to),
    status: { in: COMPLETED },
  };
}

function sqlBranch(ctx: RequestContext) {
  if (ctx.allBranches || ctx.isPlatform) return Prisma.empty;
  if (!ctx.branchIds.length) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND s."branchId" IN (${Prisma.join(ctx.branchIds)})`;
}

function sqlIn(column: Prisma.Sql, ids: string[]) {
  if (!ids.length) return Prisma.sql`AND FALSE`;
  return Prisma.sql`AND ${column} IN (${Prisma.join(ids)})`;
}

function dateKey(value: Date | string) {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

async function lowStockThreshold(tenantId: string) {
  const row = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { lowStockThreshold: true },
  });
  return row?.lowStockThreshold ?? LOW_STOCK_FALLBACK;
}

export async function dashboardSummary(ctx: RequestContext, from: string, to: string) {
  const tenantId = requireTenantId(ctx);
  const where = completedWhere(ctx, from, to);
  const expenseWhere = {
    tenantId,
    businessDate: dateRange(from, to),
    status: "POSTED" as const,
    ...branchScope(ctx),
  };

  const [totals, returnsCount, customerCountRows, profitRows, branches, expenses, customerDue, supplierDue, refunds, allowedLocs, threshold] =
    await Promise.all([
      prisma.sale.aggregate({
        where,
        _sum: { total: true, discount: true },
        _count: true,
      }),
      prisma.sale.count({
        where: {
          ...saleScope(ctx),
          businessDate: dateRange(from, to),
          status: { in: ["PARTIALLY_RETURNED", "FULLY_RETURNED"] },
        },
      }),
      prisma.$queryRaw<[{ n: number }]>`
        SELECT COUNT(DISTINCT s."customerId")::int AS n
        FROM "Sale" s
        WHERE s."tenantId" = ${tenantId}
          AND s."businessDate" >= ${from}::date
          AND s."businessDate" <= ${to}::date
          AND ${SQL_SALE_DONE}
          AND s."customerId" IS NOT NULL
          ${sqlBranch(ctx)}
      `,
      prisma.$queryRaw<[{ profit: unknown }]>`
        SELECT COALESCE(SUM(si."lineTotal" - si.qty * COALESCE(pv.cost, 0)), 0) AS profit
        FROM "SaleItem" si
        INNER JOIN "Sale" s ON s.id = si."saleId"
        LEFT JOIN "ProductVariant" pv ON pv.id = si."variantId"
        WHERE s."tenantId" = ${tenantId}
          AND s."businessDate" >= ${from}::date
          AND s."businessDate" <= ${to}::date
          AND ${SQL_SALE_DONE}
          ${sqlBranch(ctx)}
      `,
      prisma.branch.count({
        where: {
          tenantId,
          operationalStatus: "OPEN",
          ...(ctx.allBranches || ctx.isPlatform ? {} : { id: { in: ctx.branchIds } }),
        },
      }),
      prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true } }),
      prisma.customer.aggregate({ where: { tenantId }, _sum: { creditDue: true } }),
      prisma.supplier.aggregate({ where: { tenantId }, _sum: { creditDue: true } }),
      prisma.paymentTransaction.aggregate({
        where: {
          status: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] },
          sale: where,
        },
        _sum: { amount: true },
      }),
      stockRepository.allowedLocationIds(ctx),
      lowStockThreshold(tenantId),
    ]);

  const locIds = [...allowedLocs];
  const stockRows = locIds.length
    ? await prisma.$queryRaw<[{ value: unknown; low: number; out: number; total: number }]>`
        SELECT
          COALESCE(SUM(st.quantity * COALESCE(NULLIF(st."unitCost", 0), pv.cost, 0)), 0) AS value,
          COUNT(*) FILTER (
            WHERE (st.quantity - COALESCE(st."reservedQuantity", 0)) > 0
              AND (st.quantity - COALESCE(st."reservedQuantity", 0)) <= GREATEST(st."reorderLevel", ${threshold})
          )::int AS low,
          COUNT(*) FILTER (
            WHERE (st.quantity - COALESCE(st."reservedQuantity", 0)) <= 0
          )::int AS out,
          COUNT(*)::int AS total
        FROM "Stock" st
        JOIN "ProductVariant" pv ON pv.id = st."variantId"
        WHERE st."tenantId" = ${tenantId}
          ${sqlIn(Prisma.sql`st."locationId"`, locIds)}
      `
    : [{ value: 0, low: 0, out: 0, total: 0 }];

  const stock = stockRows[0] ?? { value: 0, low: 0, out: 0, total: 0 };
  const revenue = num(totals._sum.total);
  const profit = num(profitRows[0]?.profit);
  const due = num(customerDue._sum.creditDue);
  const lowStockItems = stock.low + stock.out;
  const orders = totals._count;

  return {
    from,
    to,
    todaysSales: money(revenue),
    todaysTransactions: orders,
    orders,
    revenue: money(revenue),
    todaysCustomers: customerCountRows[0]?.n ?? 0,
    todaysReturns: returnsCount,
    todaysReturnAmount: money(num(refunds._sum.amount)),
    todaysProfit: money(profit),
    profit: money(profit),
    expenses: money(num(expenses._sum.amount)),
    due: money(due),
    customerDue: money(due),
    supplierDue: money(num(supplierDue._sum.creditDue)),
    discounts: money(num(totals._sum.discount)),
    grossMargin: money(revenue === 0 ? 0 : (profit / revenue) * 100),
    currentStockValue: money(num(stock.value)),
    lowStockItems,
    outOfStockItems: stock.out,
    stockSkuCount: stock.total,
    activeOutlets: branches,
  };
}

export async function dashboardSales(ctx: RequestContext, period: string, from: string, to: string) {
  const where = completedWhere(ctx, from, to);
  const [totals, grouped] = await Promise.all([
    prisma.sale.aggregate({
      where,
      _sum: { total: true, discount: true },
      _count: true,
    }),
    prisma.sale.groupBy({
      by: ["businessDate"],
      where,
      _sum: { total: true },
      _count: true,
    }),
  ]);

  const buckets = new Map<string, { sales: number; count: number }>();
  for (const row of grouped) {
    buckets.set(dateKey(row.businessDate), { sales: num(row._sum.total), count: row._count });
  }

  const series: { date: string; sales: number; count: number }[] = [];
  let cursor = from;
  while (cursor <= to) {
    const b = buckets.get(cursor) ?? { sales: 0, count: 0 };
    series.push({ date: cursor, sales: Number(b.sales.toFixed(2)), count: b.count });
    cursor = addDays(cursor, 1);
  }

  const total = num(totals._sum.total);
  const count = totals._count;
  return {
    period,
    from,
    to,
    totalSales: money(total),
    transactionCount: count,
    averageTransactionValue: money(count ? total / count : 0),
    discounts: money(num(totals._sum.discount)),
    series,
  };
}

export async function dashboardPayments(ctx: RequestContext, from: string, to: string) {
  const where = completedWhere(ctx, from, to);
  const grouped = await prisma.paymentTransaction.groupBy({
    by: ["method", "status"],
    where: { sale: where },
    _sum: { amount: true },
  });

  const byMethod: Record<string, number> = { CASH: 0, CARD: 0, MFS: 0 };
  let refunds = 0;
  let captured = 0;
  for (const row of grouped) {
    const amount = num(row._sum.amount);
    const method = row.method.toUpperCase();
    if (row.status === "REFUNDED" || row.status === "PARTIALLY_REFUNDED") {
      refunds += amount;
      continue;
    }
    if (row.status !== "CAPTURED") continue;
    captured += amount;
    byMethod[method] = (byMethod[method] ?? 0) + amount;
  }

  const payments = Object.entries(byMethod)
    .filter(([method, amount]) => amount > 0 || methodIsCore(method))
    .map(([method, amount]) => ({ method, amount: money(amount) }));

  return {
    from,
    to,
    cash: money(byMethod.CASH ?? 0),
    card: money(byMethod.CARD ?? 0),
    mfs: money(byMethod.MFS ?? 0),
    refunds: money(refunds),
    captured: money(captured),
    payments,
  };
}

function methodIsCore(method: string) {
  return method === "CASH" || method === "CARD" || method === "MFS";
}

export async function dashboardInventory(ctx: RequestContext) {
  const tenantId = requireTenantId(ctx);
  const [allowed, threshold] = await Promise.all([
    stockRepository.allowedLocationIds(ctx),
    lowStockThreshold(tenantId),
  ]);
  const locIds = [...allowed];
  if (!locIds.length) {
    return {
      stockValue: money(0),
      lowStockCount: 0,
      outOfStockCount: 0,
      inStockCount: 0,
      skuCount: 0,
      threshold,
      lowStock: [],
      outOfStock: [],
    };
  }

  const locSql = sqlIn(Prisma.sql`st."locationId"`, locIds);
  const [aggRows, lowRows, outRows] = await Promise.all([
    prisma.$queryRaw<[{ value: unknown; low: number; out: number; total: number }]>`
      SELECT
        COALESCE(SUM(st.quantity * COALESCE(NULLIF(st."unitCost", 0), pv.cost, 0)), 0) AS value,
        COUNT(*) FILTER (
          WHERE (st.quantity - COALESCE(st."reservedQuantity", 0)) > 0
            AND (st.quantity - COALESCE(st."reservedQuantity", 0)) <= GREATEST(st."reorderLevel", ${threshold})
        )::int AS low,
        COUNT(*) FILTER (
          WHERE (st.quantity - COALESCE(st."reservedQuantity", 0)) <= 0
        )::int AS out,
        COUNT(*)::int AS total
      FROM "Stock" st
      JOIN "ProductVariant" pv ON pv.id = st."variantId"
      WHERE st."tenantId" = ${tenantId}
        ${locSql}
    `,
    prisma.$queryRaw<StockLineRow[]>`
      SELECT
        v.sku,
        p.name AS product,
        p.code,
        l.name AS location,
        (st.quantity - COALESCE(st."reservedQuantity", 0)) AS available,
        COALESCE(st."reservedQuantity", 0) AS reserved,
        COALESCE(NULLIF(st."unitCost", 0), v.cost, 0) AS cost
      FROM "Stock" st
      JOIN "ProductVariant" v ON v.id = st."variantId"
      JOIN "Product" p ON p.id = v."productId"
      JOIN "Location" l ON l.id = st."locationId"
      WHERE st."tenantId" = ${tenantId}
        ${locSql}
        AND (st.quantity - COALESCE(st."reservedQuantity", 0)) > 0
        AND (st.quantity - COALESCE(st."reservedQuantity", 0)) <= GREATEST(st."reorderLevel", ${threshold})
      ORDER BY available ASC
      LIMIT ${TOP_LIMIT}
    `,
    prisma.$queryRaw<StockLineRow[]>`
      SELECT
        v.sku,
        p.name AS product,
        p.code,
        l.name AS location,
        (st.quantity - COALESCE(st."reservedQuantity", 0)) AS available,
        COALESCE(st."reservedQuantity", 0) AS reserved,
        COALESCE(NULLIF(st."unitCost", 0), v.cost, 0) AS cost
      FROM "Stock" st
      JOIN "ProductVariant" v ON v.id = st."variantId"
      JOIN "Product" p ON p.id = v."productId"
      JOIN "Location" l ON l.id = st."locationId"
      WHERE st."tenantId" = ${tenantId}
        ${locSql}
        AND (st.quantity - COALESCE(st."reservedQuantity", 0)) <= 0
      ORDER BY available ASC
      LIMIT ${TOP_LIMIT}
    `,
  ]);

  const agg = aggRows[0] ?? { value: 0, low: 0, out: 0, total: 0 };
  const inStock = Math.max(agg.total - agg.low - agg.out, 0);
  return {
    stockValue: money(num(agg.value)),
    lowStockCount: agg.low,
    outOfStockCount: agg.out,
    inStockCount: inStock,
    skuCount: agg.total,
    threshold,
    lowStock: lowRows.map(mapStockLine),
    outOfStock: outRows.map(mapStockLine),
  };
}

type StockLineRow = {
  sku: string;
  product: string;
  code: string;
  location: string;
  available: unknown;
  reserved: unknown;
  cost: unknown;
};

function mapStockLine(row: StockLineRow) {
  const available = num(row.available);
  const reserved = num(row.reserved);
  const cost = num(row.cost);
  return {
    sku: row.sku,
    product: row.product,
    code: row.code,
    location: row.location,
    available: money(available),
    reserved: money(reserved),
    cost: money(cost),
    stockValue: money(available * cost),
  };
}

export async function dashboardCustomers(ctx: RequestContext, from: string, to: string) {
  const tenantId = requireTenantId(ctx);
  const [row] = await prisma.$queryRaw<
    [{ transactions: number; walkin: number; customers: number }]
  >`
    SELECT
      COUNT(*)::int AS transactions,
      COUNT(*) FILTER (WHERE s."customerId" IS NULL)::int AS walkin,
      COUNT(DISTINCT s."customerId")::int AS customers
    FROM "Sale" s
    WHERE s."tenantId" = ${tenantId}
      AND s."businessDate" >= ${from}::date
      AND s."businessDate" <= ${to}::date
      AND ${SQL_SALE_DONE}
      ${sqlBranch(ctx)}
  `;
  return {
    from,
    to,
    customersWithSales: row?.customers ?? 0,
    walkInTransactions: row?.walkin ?? 0,
    transactions: row?.transactions ?? 0,
  };
}

export async function dashboardReturns(ctx: RequestContext, from: string, to: string) {
  const saleWhere = {
    ...saleScope(ctx),
    businessDate: dateRange(from, to),
    status: { in: ["PARTIALLY_RETURNED" as const, "FULLY_RETURNED" as const] },
  };
  const [count, refunds] = await Promise.all([
    prisma.sale.count({ where: saleWhere }),
    prisma.paymentTransaction.aggregate({
      where: {
        status: { in: ["REFUNDED", "PARTIALLY_REFUNDED"] },
        sale: {
          ...saleScope(ctx),
          businessDate: dateRange(from, to),
        },
      },
      _sum: { amount: true },
      _count: true,
    }),
  ]);
  return {
    from,
    to,
    count,
    amount: money(num(refunds._sum.amount)),
    refundPayments: refunds._count,
  };
}

export async function dashboardTopProducts(ctx: RequestContext, from: string, to: string) {
  const tenantId = requireTenantId(ctx);
  const rows = await prisma.$queryRaw<
    { variantId: string; name: string; sku: string; qty: unknown; revenue: unknown }[]
  >`
    SELECT
      si."variantId",
      MIN(si."productNameSnapshot") AS name,
      MIN(si."skuSnapshot") AS sku,
      SUM(si.qty) AS qty,
      SUM(si."lineTotal") AS revenue
    FROM "SaleItem" si
    INNER JOIN "Sale" s ON s.id = si."saleId"
    WHERE s."tenantId" = ${tenantId}
      AND s."businessDate" >= ${from}::date
      AND s."businessDate" <= ${to}::date
      AND ${SQL_SALE_DONE}
      ${sqlBranch(ctx)}
    GROUP BY si."variantId"
    ORDER BY SUM(si."lineTotal") DESC
    LIMIT ${TOP_LIMIT}
  `;
  return rows.map((r) => ({
    variantId: r.variantId,
    name: r.name,
    sku: r.sku,
    qty: money(num(r.qty)),
    revenue: money(num(r.revenue)),
    revenueValue: Number(num(r.revenue).toFixed(2)),
  }));
}

export async function dashboardRecentSales(ctx: RequestContext) {
  const sales = await prisma.sale.findMany({
    where: { ...saleScope(ctx), status: { not: "DRAFT" } },
    orderBy: { createdAt: "desc" },
    take: RECENT_LIMIT,
    select: {
      id: true,
      invoiceNumber: true,
      total: true,
      createdAt: true,
      status: true,
      cashierId: true,
      customer: { select: { name: true } },
      branch: { select: { name: true } },
      payments: { select: { method: true, status: true } },
    },
  });
  const cashierIds = [...new Set(sales.map((s) => s.cashierId))];
  const cashiers = cashierIds.length
    ? await prisma.user.findMany({ where: { id: { in: cashierIds } }, select: { id: true, name: true } })
    : [];
  const names = new Map(cashiers.map((c) => [c.id, c.name]));
  return sales.map((s) => ({
    id: s.id,
    invoiceNumber: s.invoiceNumber,
    customer: s.customer?.name ?? "Walk-in",
    cashier: names.get(s.cashierId) ?? s.cashierId,
    outlet: s.branch.name,
    amount: money(num(s.total)),
    payment: s.payments.map((p) => p.method).join("+") || "—",
    time: s.createdAt.toISOString(),
    status: s.status,
  }));
}

export async function dashboardTopCustomers(ctx: RequestContext, from: string, to: string) {
  const grouped = await prisma.sale.groupBy({
    by: ["customerId"],
    where: { ...completedWhere(ctx, from, to), customerId: { not: null } },
    _sum: { total: true },
    _count: true,
    orderBy: { _sum: { total: "desc" } },
    take: TOP_LIMIT,
  });
  const ids = grouped.map((g) => g.customerId).filter((id): id is string => Boolean(id));
  const customers = ids.length
    ? await prisma.customer.findMany({
        where: { id: { in: ids }, tenantId: requireTenantId(ctx) },
        select: { id: true, name: true, phone: true },
      })
    : [];
  const map = new Map(customers.map((c) => [c.id, c]));
  return grouped
    .filter((g) => g.customerId && map.has(g.customerId))
    .map((g) => {
      const c = map.get(g.customerId!)!;
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        count: g._count,
        revenue: money(num(g._sum.total)),
        revenueValue: Number(num(g._sum.total).toFixed(2)),
      };
    });
}

export async function dashboardByCashier(ctx: RequestContext, from: string, to: string) {
  const grouped = await prisma.sale.groupBy({
    by: ["cashierId"],
    where: completedWhere(ctx, from, to),
    _sum: { total: true },
    _count: true,
    orderBy: { _sum: { total: "desc" } },
    take: TOP_LIMIT,
  });
  const ids = grouped.map((g) => g.cashierId);
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const names = new Map(users.map((u) => [u.id, u.name]));
  return grouped.map((g) => ({
    cashierId: g.cashierId,
    cashier: names.get(g.cashierId) ?? g.cashierId,
    count: g._count,
    total: money(num(g._sum.total)),
    totalValue: Number(num(g._sum.total).toFixed(2)),
  }));
}

export async function dashboardHourly(ctx: RequestContext, from: string, to: string) {
  const tenantId = requireTenantId(ctx);
  const rows = await prisma.$queryRaw<{ hour: number; sales: unknown; count: number }[]>`
    SELECT
      EXTRACT(HOUR FROM s."createdAt")::int AS hour,
      COALESCE(SUM(s.total), 0) AS sales,
      COUNT(*)::int AS count
    FROM "Sale" s
    WHERE s."tenantId" = ${tenantId}
      AND s."businessDate" >= ${from}::date
      AND s."businessDate" <= ${to}::date
      AND ${SQL_SALE_DONE}
      ${sqlBranch(ctx)}
    GROUP BY 1
  `;
  const hours = Array.from({ length: 24 }, (_, h) => ({
    hour: String(h).padStart(2, "0"),
    sales: 0,
    count: 0,
  }));
  for (const row of rows) {
    const h = Number(row.hour);
    if (h < 0 || h > 23) continue;
    hours[h].sales = Number(num(row.sales).toFixed(2));
    hours[h].count = row.count;
  }
  return hours;
}

export async function dashboardRecentActivity(ctx: RequestContext) {
  const tenantId = requireTenantId(ctx);
  const rows = await prisma.auditLog.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
    take: ACTIVITY_LIMIT,
    select: { id: true, action: true, entityType: true, entityId: true, createdAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    time: r.createdAt.toISOString(),
  }));
}
