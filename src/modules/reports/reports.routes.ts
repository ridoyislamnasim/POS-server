import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { branchScope, money, num, tenantId } from "../../lib/erp.js";
import type { AuthedRequest } from "../../types.js";

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
  const rows = await prisma.sale.findMany({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte } },
    include: { payments: true, branch: true, customer: true },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return ok(res, {
    from: r.from,
    to: r.to,
    total: money(rows.reduce((n, s) => n + num(s.total), 0)),
    count: rows.length,
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
  });
});

reportsRouter.get("/purchases", requirePermission("purchase.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const rows = await prisma.purchase.findMany({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte } },
    include: { supplier: true, branch: true },
  });
  return ok(res, {
    from: r.from,
    to: r.to,
    total: money(rows.reduce((n, p) => n + num(p.total), 0)),
    due: money(rows.reduce((n, p) => n + num(p.due), 0)),
    rows,
  });
});

reportsRouter.get("/inventory", requirePermission("inventory.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.stock.findMany({
    where: { tenantId: tenantId(ctx) },
    include: { variant: { include: { product: true } }, location: true },
  });
  return ok(res, {
    stockValue: money(rows.reduce((n, r) => n + num(r.quantity) * num(r.variant.cost), 0)),
    rows: rows.map((r) => ({
      sku: r.variant.sku,
      product: r.variant.product.name,
      location: r.location.name,
      qty: money(num(r.quantity)),
      reserved: money(num(r.reservedQuantity)),
      cost: money(num(r.variant.cost)),
      value: money(num(r.quantity) * num(r.variant.cost)),
    })),
  });
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
  const rows = await prisma.expense.findMany({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte } },
    include: { category: true, branch: true },
  });
  return ok(res, { from: r.from, to: r.to, total: money(rows.reduce((n, e) => n + num(e.amount), 0)), rows });
});

reportsRouter.get("/dues", requirePermission("finance.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const customers = await prisma.customer.findMany({ where: { tenantId: tenantId(ctx), creditDue: { gt: 0 } } });
  const suppliers = await prisma.supplier.findMany({ where: { tenantId: tenantId(ctx), creditDue: { gt: 0 } } });
  return ok(res, {
    customerDue: money(customers.reduce((n, c) => n + num(c.creditDue), 0)),
    supplierDue: money(suppliers.reduce((n, s) => n + num(s.creditDue), 0)),
    customers,
    suppliers,
  });
});

reportsRouter.get("/tax", requirePermission("report.finance"), async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const sales = await prisma.sale.findMany({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte } },
  });
  const purchases = await prisma.purchase.findMany({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte } },
  });
  const output = sales.reduce((n, s) => n + num(s.tax), 0);
  const input = purchases.reduce((n, p) => n + num(p.tax), 0);
  return ok(res, {
    from: r.from,
    to: r.to,
    outputVat: money(output),
    inputVat: money(input),
    payable: money(output - input),
    salesCount: sales.length,
    purchaseCount: purchases.length,
  });
});

reportsRouter.get("/cashier", async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const sales = await prisma.sale.findMany({
    where: { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte }, status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] } },
  });
  const ids = [...new Set(sales.map((s) => s.cashierId))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const map = new Map<string, { cashierId: string; name: string; count: number; total: number }>();
  for (const s of sales) {
    const cur = map.get(s.cashierId) ?? { cashierId: s.cashierId, name: names.get(s.cashierId) ?? s.cashierId, count: 0, total: 0 };
    cur.count += 1;
    cur.total += num(s.total);
    map.set(s.cashierId, cur);
  }
  return ok(res, [...map.values()].map((r) => ({ ...r, total: money(r.total) })).sort((a, b) => Number(b.total) - Number(a.total)));
});

reportsRouter.get("/products", async (req, res) => {
  const ctx = ctxOf(req);
  const r = range(req);
  const items = await prisma.saleItem.findMany({
    where: {
      sale: { tenantId: tenantId(ctx), ...branchScope(ctx), businessDate: { gte: r.gte, lte: r.lte }, status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] } },
    },
  });
  const map = new Map<string, { sku: string; name: string; qty: number; revenue: number }>();
  for (const i of items) {
    const cur = map.get(i.variantId) ?? { sku: i.skuSnapshot, name: i.productNameSnapshot, qty: 0, revenue: 0 };
    cur.qty += num(i.qty);
    cur.revenue += num(i.lineTotal);
    map.set(i.variantId, cur);
  }
  return ok(res, [...map.values()].sort((a, b) => b.revenue - a.revenue).map((r) => ({ ...r, qty: money(r.qty), revenue: money(r.revenue) })));
});
