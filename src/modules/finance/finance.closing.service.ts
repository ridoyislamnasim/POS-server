import { branchScope, money, num, tenantId } from "../../lib/erp.js";
import { acceptDate, dateRange, parseListQuery, scopedBranchId, withPagination } from "../../lib/list-query.js";
import { prisma } from "../../lib/prisma.js";
import { assertBranch } from "../../lib/scope.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { financeRepository } from "./finance.repository.js";
import type { CreateDailyClosingInput, ReportRangeQuery } from "./finance.types.js";
import { computeProfit } from "./profit.js";

/**
 * Finance reporting + daily-closing logic, split from `finance.service.ts`
 * because the aggregate calculations are a separate responsibility.
 * No Express `req`/`res` here.
 */
export const financeClosingService = {
  async cashFlow(ctx: RequestContext, query: ReportRangeQuery) {
    const from = String(query.from ?? ctx.businessDate);
    const to = String(query.to ?? ctx.businessDate);
    const _range = dateRange(acceptDate(from), acceptDate(to));
    const range = _range?.gte && _range?.lte ? { gte: _range.gte, lte: _range.lte } : { gte: new Date(from), lte: new Date(new Date(to).setHours(23, 59, 59, 999)) };
    const tid = tenantId(ctx);
    const scope = branchScope(ctx);
    const [sales, expenses, incomes, pays, refunds] = await Promise.all([
      financeRepository.salesForRange(tid, scope, range, ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"]),
      financeRepository.expensesForRange(tid, scope, range, "POSTED"),
      financeRepository.incomeForRange(tid, scope, range),
      financeRepository.paymentsForRange(tid, scope, range),
      financeRepository.refundsForRange(tid, scope, range),
    ]);
    const salesCollected = sales.flatMap((s) => s.payments).filter((p) => p.status === "CAPTURED").reduce((n, p) => n + num(p.amount), 0);
    const refundTotal = refunds.reduce((n, r) => n + num((r as { amount: unknown }).amount), 0);
    const refundsByMethodMap: Record<string, number> = {};
    for (const r of refunds) {
      const key = String((r as { method?: string }).method ?? "CASH").toUpperCase();
      refundsByMethodMap[key] = (refundsByMethodMap[key] ?? 0) + num((r as { amount: unknown }).amount);
    }
    const refundsByMethod = Object.entries(refundsByMethodMap).map(([method, amount]) => ({ method, amount: money(amount) }));

    const inflows =
      salesCollected + incomes.reduce((n, r) => n + num(r.amount), 0) + pays.filter((p) => p.direction === "IN").reduce((n, p) => n + num(p.amount), 0);
    const outflows =
      expenses.reduce((n, r) => n + num(r.amount), 0) + pays.filter((p) => p.direction === "OUT").reduce((n, p) => n + num(p.amount), 0) + refundTotal;

    // --- additional aggregates for charts (reuse same range, no extra queries) ---
    const toISO = (d: Date | string | null | undefined) => {
      if (!d) return "";
      const dd = d instanceof Date ? d : new Date(d);
      return dd.toISOString().slice(0, 10);
    };
    // daily trend: one point per day in [from, to]
    const trendMap = new Map<string, { date: string; inflow: number; outflow: number }>();
    const start = new Date(from + "T00:00:00");
    const end = new Date(to + "T00:00:00");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const k = toISO(d);
      trendMap.set(k, { date: k, inflow: 0, outflow: 0 });
    }
    const bumpIn = (key: string, v: number) => {
      const e = trendMap.get(key);
      if (e) e.inflow += v;
    };
    const bumpOut = (key: string, v: number) => {
      const e = trendMap.get(key);
      if (e) e.outflow += v;
    };
    for (const s of sales) {
      const k = toISO(s.businessDate as unknown as Date);
      for (const p of s.payments) if (p.status === "CAPTURED") bumpIn(k, num(p.amount));
    }
    for (const r of incomes) bumpIn(toISO(r.businessDate as unknown as Date), num(r.amount));
    for (const p of pays) {
      const k = toISO((p as { businessDate: Date }).businessDate);
      if (p.direction === "IN") bumpIn(k, num(p.amount));
      else bumpOut(k, num(p.amount));
    }
    for (const e of expenses) bumpOut(toISO(e.businessDate as unknown as Date), num(e.amount));
    for (const r of refunds as unknown as Array<{ amount: unknown; method: string; saleReturn?: { createdAt: Date } }>) {
      const k = toISO(r.saleReturn?.createdAt);
      // fallback to saleReturn null? use from date if missing
      bumpOut(k || from, num(r.amount));
    }
    const trend = Array.from(trendMap.values()).map((e) => ({
      date: e.date,
      inflow: money(e.inflow),
      outflow: money(e.outflow),
      net: money(e.inflow - e.outflow),
      inflowN: e.inflow,
      outflowN: e.outflow,
      netN: e.inflow - e.outflow,
    }));

    // method breakdown: inflow vs outflow per method
    const methodMap = new Map<string, { method: string; inflow: number; outflow: number }>();
    const addMethod = (raw: string | undefined, inflow: number, outflow: number) => {
      const k = String(raw ?? "OTHER").toUpperCase().trim() || "OTHER";
      const cur = methodMap.get(k) ?? { method: k, inflow: 0, outflow: 0 };
      cur.inflow += inflow;
      cur.outflow += outflow;
      methodMap.set(k, cur);
    };
    for (const s of sales) for (const p of s.payments) if (p.status === "CAPTURED") addMethod(p.method, num(p.amount), 0);
    for (const r of incomes) addMethod((r as { method?: string }).method, num(r.amount), 0);
    for (const p of pays) {
      if (p.direction === "IN") addMethod(p.method, num(p.amount), 0);
      else addMethod(p.method, 0, num(p.amount));
    }
    for (const e of expenses) addMethod((e as { method?: string }).method, 0, num(e.amount));
    for (const r of refunds as unknown as Array<{ amount: unknown; method: string }>) addMethod(r.method, 0, num(r.amount));

    // normalize to expected buckets but keep raw; frontend will bucket OTHER
    const methodBreakdown = Array.from(methodMap.values()).map((m) => ({
      method: m.method,
      inflow: money(m.inflow),
      outflow: money(m.outflow),
      inflowN: m.inflow,
      outflowN: m.outflow,
    }));

    return {
      from,
      to,
      inflows: money(inflows),
      outflows: money(outflows),
      net: money(inflows - outflows),
      salesCollected: money(salesCollected),
      salesIn: money(salesCollected),
      refunds: money(refundTotal),
      refundsByMethod,
      expenses: money(expenses.reduce((n, r) => n + num(r.amount), 0)),
      income: money(incomes.reduce((n, r) => n + num(r.amount), 0)),
      duesCollected: money(pays.filter((p) => p.direction === "IN").reduce((n, p) => n + num(p.amount), 0)),
      supplierPaid: money(pays.filter((p) => p.direction === "OUT").reduce((n, p) => n + num(p.amount), 0)),
      trend,
      methodBreakdown,
    };
  },

  async profitLoss(ctx: RequestContext, query: ReportRangeQuery) {
    const from = String(query.from ?? ctx.businessDate);
    const to = String(query.to ?? ctx.businessDate);
    // Unified calculation — return ≠ damage ≠ adjustment, historical COGS via variant cost snapshot limitation noted in profit.ts
    const p = await computeProfit(ctx, from, to);
    return {
      from: p.from,
      to: p.to,
      revenue: p.revenue,
      cogs: p.cogs,
      grossProfit: p.grossProfit,
      tax: p.tax,
      otherIncome: p.otherIncome,
      expenses: p.expenses,
      netProfit: p.netProfit,
      expenseBreakdown: p.expenseBreakdown,
    };
  },

  async listDailyClosings(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["businessDate", "createdAt"],
      defaultSort: "businessDate",
      defaultOrder: "desc",
    });
    const branchId = scopedBranchId(ctx, query.branchId);
    const dates = dateRange(list.dateFrom, list.dateTo);
    const where = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      ...(branchId ? { branchId } : {}),
      ...(dates ? { businessDate: dates } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        financeRepository.listDailyClosings({ where, skip, take, order: list.sortOrder }),
      count: () => financeRepository.countDailyClosings(where),
    });
  },

  async createDailyClosing(ctx: RequestContext, input: CreateDailyClosingInput) {
    const { branchId, countedCash, openingCash, notes } = input;
    if (!branchId || countedCash == null) {
      throw new AppError("VALIDATION", "branchId and countedCash required", 400);
    }
    assertBranch(ctx, branchId);
    const date = new Date(ctx.businessDate);
    const tid = tenantId(ctx);
    const range = { gte: date, lte: date };
    const [sales, expenses, incomes, pays] = await Promise.all([
      financeRepository.salesForRange(tid, { branchId }, range, ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"]),
      financeRepository.expensesForRange(tid, { branchId }, range, "POSTED"),
      financeRepository.incomeForRange(tid, { branchId }, range),
      financeRepository.paymentsForRange(tid, { branchId }, range),
    ]);
    const cash = (p: { method: string }) => p.method.toUpperCase() === "CASH";
    const salesCash = sales
      .flatMap((s) => s.payments)
      .filter((p) => cash(p) && p.status === "CAPTURED")
      .reduce((n, p) => n + num(p.amount), 0);
    const refundCash = sales
      .flatMap((s) => s.payments)
      .filter((p) => cash(p) && (p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED"))
      .reduce((n, p) => n + num(p.amount), 0);
    const expenseCash = expenses.filter((e) => cash(e)).reduce((n, e) => n + num(e.amount), 0);
    const incomeCash = incomes.filter((e) => cash(e)).reduce((n, e) => n + num(e.amount), 0);
    const paymentsIn = pays.filter((p) => p.direction === "IN" && cash(p)).reduce((n, p) => n + num(p.amount), 0);
    const paymentsOut = pays.filter((p) => p.direction === "OUT" && cash(p)).reduce((n, p) => n + num(p.amount), 0);
    const open = num(openingCash ?? 0);
    const expected = open + salesCash + incomeCash + paymentsIn - expenseCash - paymentsOut - refundCash;
    const counted = num(countedCash);
    const row = await financeRepository.upsertDailyClosing(
      { tenantId: tid, branchId, businessDate: date },
      {
        openingCash: String(open),
        salesCash: String(salesCash),
        expenseCash: String(expenseCash),
        incomeCash: String(incomeCash),
        paymentsIn: String(paymentsIn),
        paymentsOut: String(paymentsOut),
        expectedCash: String(expected),
        countedCash: String(counted),
        variance: String(counted - expected),
        notes,
        closedById: ctx.userId,
      },
      {
        openingCash: String(open),
        salesCash: String(salesCash),
        expenseCash: String(expenseCash),
        incomeCash: String(incomeCash),
        paymentsIn: String(paymentsIn),
        paymentsOut: String(paymentsOut),
        expectedCash: String(expected),
        countedCash: String(counted),
        variance: String(counted - expected),
        notes,
        closedById: ctx.userId,
      },
    );
    if (Number(row.variance) !== 0) {
      await enqueueOutbox(prisma, {
        tenantId: tid,
        type: "CASH_VARIANCE",
        aggregateId: row.id,
        payload: {
          branchId,
          variance: row.variance,
          message: `Daily close variance ${row.variance} at ${row.branch.name}.`,
          entityType: "DailyClosing",
          entityId: row.id,
        },
      });
    }
    return row;
  },
};
