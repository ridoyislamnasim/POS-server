import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { branchScope, money, num, tenantId } from "../../lib/erp.js";
import type { AuthedRequest } from "../../types.js";
import { paginationMeta, parseListQuery } from "../../lib/list-query.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireTenant, requirePermission("report.view"));

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

function range(req: Request) {
  const ctx = ctxOf(req);
  const from = String(req.query.from ?? ctx.businessDate);
  const to = String(req.query.to ?? ctx.businessDate);
  return { from, to, gte: new Date(from), lte: new Date(to) };
}

reportsRouter.get("/sales", async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "total", "invoiceNumber"], defaultSort: "createdAt", defaultOrder: "desc" });
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
    prisma.sale.aggregate({ where, _sum: { total: true, paid: true, due: true, tax: true }, _count: true }),
    prisma.sale.findMany({
      where,
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
      skip: list.skip,
      take: list.take,
    }),
  ]);
  const pagination = paginationMeta(agg._count, list.page, list.limit);
  return ok(
    res,
    {
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
    pagination,
  );
});

reportsRouter.get("/purchases", requirePermission("purchase.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "total"], defaultSort: "createdAt", defaultOrder: "desc" });
  const where = { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte } };
  const [agg, rows] = await Promise.all([
    prisma.purchase.aggregate({ where, _sum: { total: true, due: true }, _count: true }),
    prisma.purchase.findMany({
      where,
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
      skip: list.skip,
      take: list.take,
    }),
  ]);
  return ok(
    res,
    {
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
    paginationMeta(agg._count, list.page, list.limit),
  );
});

reportsRouter.get("/inventory", requirePermission("inventory.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["sku"], defaultSort: "sku", defaultOrder: "asc" });
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
    prisma.stock.count({ where }),
    prisma.stock.findMany({
      where,
      include: { variant: { include: { product: { select: { name: true } } } }, location: { select: { name: true } } },
      skip: list.skip,
      take: list.take,
      orderBy: { variant: { sku: "asc" } },
    }),
    prisma.$queryRaw<[{ value: string | null; available: string | null; damaged: string | null }]>`
      SELECT
        COALESCE(SUM(s.quantity * v.cost), 0)::text AS value,
        COALESCE(SUM((s.quantity - s."reservedQuantity") * v.cost), 0)::text AS available,
        COALESCE(SUM(s."damagedQuantity" * v.cost), 0)::text AS damaged
      FROM "Stock" s
      JOIN "ProductVariant" v ON v.id = s."variantId"
      WHERE s."tenantId" = ${tid}
    `,
  ]);
  return ok(
    res,
    {
      stockValue: money(num(valueAgg[0]?.value)),
      availableValue: money(num(valueAgg[0]?.available)),
      damagedValue: money(num(valueAgg[0]?.damaged)),
      rows: rows.map((r) => ({
        sku: r.variant.sku,
        product: r.variant.product.name,
        location: r.location.name,
        available: money(num(r.quantity) - num(r.reservedQuantity)),
        reserved: money(num(r.reservedQuantity)),
        damaged: money(num(r.damagedQuantity)),
        quarantine: money(num(r.quarantineQuantity)),
        physical: money(num(r.quantity) + num(r.damagedQuantity) + num(r.quarantineQuantity)),
        cost: money(num(r.variant.cost)),
        value: money((num(r.quantity) - num(r.reservedQuantity)) * num(r.variant.cost)),
      })),
    },
    paginationMeta(total, list.page, list.limit),
  );
});

reportsRouter.get("/profit", requirePermission("report.finance"), async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const sales = await prisma.sale.findMany({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte }, status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] } },
    include: { items: true },
  });
  const expenses = await prisma.expense.aggregate({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte }, status: "POSTED" },
    _sum: { amount: true },
  });
  const variantIds = [...new Set(sales.flatMap((s) => s.items.map((i) => i.variantId)))];
  const costs = await prisma.productVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, cost: true } });
  const costMap = new Map(costs.map((c) => [c.id, num(c.cost)]));
  let cogs = 0;
  for (const s of sales) for (const i of s.items) cogs += num(i.qty) * (costMap.get(i.variantId) ?? 0);
  const revenue = sales.reduce((n, s) => n + num(s.total), 0);
  return ok(res, {
    from: r.from,
    to: r.to,
    revenue: money(revenue),
    cogs: money(cogs),
    gross: money(revenue - cogs),
    expenses: money(num(expenses._sum.amount)),
    net: money(revenue - cogs - num(expenses._sum.amount)),
  });
});

reportsRouter.get("/expenses", requirePermission("expense.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "amount"], defaultSort: "createdAt", defaultOrder: "desc" });
  const where = { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte } };
  const [agg, rows] = await Promise.all([
    prisma.expense.aggregate({ where, _sum: { amount: true }, _count: true }),
    prisma.expense.findMany({
      where,
      include: { category: { select: { name: true } }, branch: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: list.skip,
      take: list.take,
    }),
  ]);
  return ok(
    res,
    {
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
    paginationMeta(agg._count, list.page, list.limit),
  );
});

reportsRouter.get("/dues", requirePermission("finance.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["creditDue", "name"], defaultSort: "creditDue", defaultOrder: "desc" });
  const q = list.search;
  const customerWhere = {
    tenantId: tenantId(ctx),
    creditDue: { gt: 0 },
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };
  const [customerDue, customers, customerCount, suppliers] = await Promise.all([
    prisma.customer.aggregate({ where: { tenantId: tenantId(ctx), creditDue: { gt: 0 } }, _sum: { creditDue: true } }),
    prisma.customer.findMany({
      where: customerWhere,
      select: { id: true, name: true, phone: true, creditDue: true },
      orderBy: { creditDue: "desc" },
      skip: list.skip,
      take: list.take,
    }),
    prisma.customer.count({ where: customerWhere }),
    prisma.supplier.aggregate({ where: { tenantId: tenantId(ctx), creditDue: { gt: 0 } }, _sum: { creditDue: true } }),
  ]);
  return ok(
    res,
    {
      customerDue: money(num(customerDue._sum.creditDue)),
      supplierDue: money(num(suppliers._sum.creditDue)),
      customers,
      rows: customers,
    },
    paginationMeta(customerCount, list.page, list.limit),
  );
});

reportsRouter.get("/tax", requirePermission("report.finance"), async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const saleWhere = { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte } };
  const [sales, purchases] = await Promise.all([
    prisma.sale.aggregate({ where: saleWhere, _sum: { tax: true }, _count: true }),
    prisma.purchase.aggregate({ where: saleWhere, _sum: { tax: true }, _count: true }),
  ]);
  const output = num(sales._sum.tax);
  const input = num(purchases._sum.tax);
  return ok(res, {
    from: r.from,
    to: r.to,
    outputVat: money(output),
    inputVat: money(input),
    payable: money(output - input),
    salesCount: sales._count,
    purchaseCount: purchases._count,
  });
});

reportsRouter.get("/cashier", async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const list = parseListQuery(req.query, { defaultLimit: 25 });
  const grouped = await prisma.sale.groupBy({
    by: ["cashierId"],
    where: {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      businessDate: { gte: r.gte, lte: r.lte },
      status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
    },
    _sum: { total: true },
    _count: true,
  });
  grouped.sort((a, b) => num(b._sum.total) - num(a._sum.total));
  const pageSlice = grouped.slice(list.skip, list.skip + list.take);
  const users = await prisma.user.findMany({
    where: { id: { in: pageSlice.map((g) => g.cashierId) } },
    select: { id: true, name: true },
  });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return ok(
    res,
    pageSlice.map((g) => ({
      cashierId: g.cashierId,
      name: names.get(g.cashierId) ?? g.cashierId,
      count: g._count,
      total: money(num(g._sum.total)),
    })),
    paginationMeta(grouped.length, list.page, list.limit),
  );
});

reportsRouter.get("/products", async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const list = parseListQuery(req.query, { defaultLimit: 25 });
  const grouped = await prisma.saleItem.groupBy({
    by: ["variantId", "skuSnapshot", "productNameSnapshot"],
    where: {
      sale: {
        tenantId: tenantId(ctx),
        ...branchScope(ctx),
        businessDate: { gte: r.gte, lte: r.lte },
        status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] },
      },
    },
    _sum: { qty: true, lineTotal: true },
  });
  grouped.sort((a, b) => num(b._sum.lineTotal) - num(a._sum.lineTotal));
  const pageSlice = grouped.slice(list.skip, list.skip + list.take);
  return ok(
    res,
    pageSlice.map((g) => ({
      sku: g.skuSnapshot,
      name: g.productNameSnapshot,
      qty: money(num(g._sum.qty)),
      revenue: money(num(g._sum.lineTotal)),
    })),
    paginationMeta(grouped.length, list.page, list.limit),
  );
});

reportsRouter.get("/returns", requirePermission("sale.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "number"], defaultSort: "createdAt", defaultOrder: "desc" });
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
    prisma.saleReturn.aggregate({ where: postedWhere, _sum: { refundedAmount: true }, _count: true }),
    prisma.saleReturnItem.aggregate({ where: { saleReturn: postedWhere }, _sum: { qty: true, lineRefund: true } }),
    prisma.saleReturn.count({ where: postedWhere }),
    prisma.saleReturn.findMany({
      where: postedWhere,
      include: { items: { select: { qty: true, lineRefund: true } }, sale: { select: { invoiceNumber: true } } },
      orderBy: { createdAt: "desc" },
      skip: list.skip,
      take: list.take,
    }),
  ]);
  return ok(
    res,
    {
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
    paginationMeta(count, list.page, list.limit),
  );
});

reportsRouter.get("/receiving", requirePermission("inventory.receive.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "number"], defaultSort: "createdAt", defaultOrder: "desc" });
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    ...branchScope(ctx),
    status: "RECEIVED" as const,
    createdAt: { gte: r.gte, lte: r.lte },
    ...(q
      ? {
          OR: [{ number: { contains: q, mode: "insensitive" as const } }, { supplier: { name: { contains: q, mode: "insensitive" as const } } }],
        }
      : {}),
  };
  const [kpi, count, rows] = await Promise.all([
    prisma.stockReceipt.aggregate({ where, _sum: { totalQty: true, totalCost: true }, _count: true }),
    prisma.stockReceipt.count({ where }),
    prisma.stockReceipt.findMany({
      where,
      select: { number: true, kind: true, totalQty: true, totalCost: true, status: true, supplier: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: list.skip,
      take: list.take,
    }),
  ]);
  return ok(
    res,
    {
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
    paginationMeta(count, list.page, list.limit),
  );
});

reportsRouter.get("/damage", requirePermission("inventory.damage.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "number"], defaultSort: "createdAt", defaultOrder: "desc" });
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    ...branchScope(ctx),
    createdAt: { gte: r.gte, lte: r.lte },
    status: { in: ["STOCK_ADJUSTED" as const, "APPROVED" as const] },
    ...(q ? { OR: [{ number: { contains: q, mode: "insensitive" as const } }, { description: { contains: q, mode: "insensitive" as const } }] } : {}),
  };
  const [kpi, count, rows] = await Promise.all([
    prisma.stockDamage.aggregate({ where, _sum: { totalQty: true, totalCost: true }, _count: true }),
    prisma.stockDamage.count({ where }),
    prisma.stockDamage.findMany({
      where,
      select: { number: true, reason: true, status: true, totalQty: true, totalCost: true },
      orderBy: { createdAt: "desc" },
      skip: list.skip,
      take: list.take,
    }),
  ]);
  return ok(
    res,
    {
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
    paginationMeta(count, list.page, list.limit),
  );
});
