import { prisma } from "../../lib/prisma.js";
import { money, num, tenantId as tenantIdOf, branchScope } from "../../lib/erp.js";
import { acceptDate, dateRange } from "../../lib/list-query.js";
import type { RequestContext } from "../../types.js";

/**
 * Unified profit calculation — single source of truth for Dashboard, P&L and Profit Report.
 * - Revenue is VAT-inclusive (Sale.total includes tax, as per sales.service lineTotals).
 * - Reuses existing models only: Sale, SaleItem, SaleReturn, SaleReturnItem, SaleReturnExchange, Expense, Income.
 * - Historical COGS limitation: SaleItem does NOT store cost snapshot, so we use current ProductVariant.cost.
 *   This is documented; a future migration could snapshot cost onto SaleItem at sale time.
 * - Return ≠ Damage ≠ Adjustment: damage/quarantine stock moves are inventory-only, not P&L loss.
 *   Only qualified shrinkage would be P&L, but current StockMovement.reason is free-text with no taxonomy,
 *   so adjustment loss is 0 by design (reported as limitation).
 */
export async function computeProfit(ctx: RequestContext, from: string, to: string) {
  const tid = tenantIdOf(ctx);
  const scope = branchScope(ctx) as Record<string, unknown>;
  const range = dateRange(acceptDate(from), acceptDate(to)) ?? { gte: new Date(from), lte: new Date(to) };
  // Ensure lte is end-of-day if caller passed date-only strings (mirrors list-query behavior)
  // dateRange already does this, but direct {gte: new Date(from)} in old code did not — we fix here.

  // Sales in period — include all completed family, then net via returns
  const sales = await prisma.sale.findMany({
    where: { tenantId: tid, ...(scope as object), businessDate: range as never, status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] as never } },
    include: { items: true },
  });

  // Returns that reverse revenue/COGS — filter by sale's businessDate so net is in sale period (accrual).
  // If a return happens later but sale was in period, it still nets that period. This is a business-rule choice
  // documented as limitation: SaleReturn has no businessDate of its own.
  const returns = await prisma.saleReturn.findMany({
    where: {
      tenantId: tid,
      ...(scope as object),
      status: { in: ["APPROVED", "COMPLETED"] as never },
      sale: { businessDate: range as never },
    },
    include: { items: true, exchangeItems: true },
  });

  const expenses = await prisma.expense.findMany({
    where: { tenantId: tid, ...(scope as object), businessDate: range as never, status: "POSTED" as never },
    include: { category: true },
  });

  const incomes = await prisma.income.findMany({
    where: { tenantId: tid, ...(scope as object), businessDate: range as never },
  });

  // Cost map — current variant cost (historical limitation noted above)
  const variantIds = [
    ...new Set([
      ...sales.flatMap((s) => s.items.map((i) => i.variantId)),
      ...returns.flatMap((r) => r.items.map((i) => i.variantId)),
      ...returns.flatMap((r) => r.exchangeItems.map((e) => e.variantId)),
    ]),
  ];
  const costs = variantIds.length
    ? await prisma.productVariant.findMany({ where: { tenantId: tid, id: { in: variantIds } }, select: { id: true, cost: true } })
    : [];
  const costMap = new Map(costs.map((c) => [c.id, num(c.cost)]));

  let grossRevenue = 0;
  for (const s of sales) grossRevenue += num(s.total);

  let returnRevenue = 0;
  for (const r of returns) for (const i of r.items) returnRevenue += num(i.lineRefund);

  // Exchange revenue — SaleReturnExchange.lineTotal is price*qty without per-line tax/discount rounding.
  // For minimal fix we add it as revenue (new goods issued). This is documented as partial: tax not included.
  let exchangeRevenue = 0;
  for (const r of returns) for (const e of r.exchangeItems) exchangeRevenue += num(e.lineTotal);

  const netRevenue = grossRevenue - returnRevenue + exchangeRevenue;

  let grossCogs = 0;
  for (const s of sales) for (const i of s.items) grossCogs += num(i.qty) * (costMap.get(i.variantId) ?? 0);

  let cogsReversal = 0;
  for (const r of returns) for (const i of r.items) cogsReversal += num(i.qty) * (costMap.get(i.variantId) ?? 0);

  let exchangeCogs = 0;
  for (const r of returns) for (const e of r.exchangeItems) exchangeCogs += num(e.qty) * (costMap.get(e.variantId) ?? 0);

  const netCogs = grossCogs - cogsReversal + exchangeCogs;

  const grossProfit = netRevenue - netCogs;
  const otherIncome = incomes.reduce((n, r) => n + num(r.amount), 0);
  const expenseTotal = expenses.reduce((n, r) => n + num(r.amount), 0);
  const tax = sales.reduce((n, s) => n + num(s.tax), 0);
  // Return tax is already inside lineRefund (VAT-inclusive), so net tax is gross tax minus return tax portion.
  // We keep tax as gross tax for display (net tax would require per-item tax reversal, not stored).
  const netProfit = grossProfit + otherIncome - expenseTotal;
  const byCat: Record<string, number> = {};
  for (const e of expenses) {
    const k = (e.category as unknown as { name: string }).name ?? "Uncategorized";
    byCat[k] = (byCat[k] ?? 0) + num(e.amount);
  }

  return {
    from,
    to,
    grossRevenue: money(grossRevenue),
    returnRevenue: money(returnRevenue),
    exchangeRevenue: money(exchangeRevenue),
    revenue: money(netRevenue),
    grossCogs: money(grossCogs),
    cogsReversal: money(cogsReversal),
    exchangeCogs: money(exchangeCogs),
    cogs: money(netCogs),
    grossProfit: money(grossProfit),
    tax: money(tax),
    otherIncome: money(otherIncome),
    expenses: money(expenseTotal),
    netProfit: money(netProfit),
    expenseBreakdown: Object.entries(byCat).map(([category, amount]) => ({ category, amount: money(amount) })),
    // Raw numbers for callers that need them
    _raw: { grossRevenue, returnRevenue, exchangeRevenue, netRevenue, grossCogs, cogsReversal, exchangeCogs, netCogs, grossProfit, otherIncome, expenseTotal, netProfit, tax },
  };
}
