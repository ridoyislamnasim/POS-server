import { branchScope, money, num, tenantId } from "../../lib/erp.js";
import { dateRange, parseListQuery, scopedBranchId, withPagination } from "../../lib/list-query.js";
import { prisma } from "../../lib/prisma.js";
import { assertBranch } from "../../lib/scope.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { financeRepository } from "./finance.repository.js";
import type { CreateDailyClosingInput, ReportRangeQuery } from "./finance.types.js";

/**
 * Finance reporting + daily-closing logic, split from `finance.service.ts`
 * because the aggregate calculations are a separate responsibility.
 * No Express `req`/`res` here.
 */
export const financeClosingService = {
  async cashFlow(ctx: RequestContext, query: ReportRangeQuery) {
    const from = String(query.from ?? ctx.businessDate);
    const to = String(query.to ?? ctx.businessDate);
    const range = { gte: new Date(from), lte: new Date(to) };
    const tid = tenantId(ctx);
    const scope = branchScope(ctx);
    const [sales, expenses, incomes, pays] = await Promise.all([
      financeRepository.salesForRange(tid, scope, range, ["COMPLETED", "PARTIALLY_RETURNED"]),
      financeRepository.expensesForRange(tid, scope, range, "POSTED"),
      financeRepository.incomeForRange(tid, scope, range),
      financeRepository.paymentsForRange(tid, range),
    ]);
    const inflows =
      sales.flatMap((s) => s.payments).filter((p) => p.status === "CAPTURED").reduce((n, p) => n + num(p.amount), 0) +
      incomes.reduce((n, r) => n + num(r.amount), 0) +
      pays.filter((p) => p.direction === "IN").reduce((n, p) => n + num(p.amount), 0);
    const outflows =
      expenses.reduce((n, r) => n + num(r.amount), 0) +
      pays.filter((p) => p.direction === "OUT").reduce((n, p) => n + num(p.amount), 0);
    return {
      from,
      to,
      inflows: money(inflows),
      outflows: money(outflows),
      net: money(inflows - outflows),
      salesIn: money(sales.reduce((n, s) => n + num(s.paid), 0)),
      expenses: money(expenses.reduce((n, r) => n + num(r.amount), 0)),
      income: money(incomes.reduce((n, r) => n + num(r.amount), 0)),
      duesCollected: money(pays.filter((p) => p.direction === "IN").reduce((n, p) => n + num(p.amount), 0)),
      supplierPaid: money(pays.filter((p) => p.direction === "OUT").reduce((n, p) => n + num(p.amount), 0)),
    };
  },

  async profitLoss(ctx: RequestContext, query: ReportRangeQuery) {
    const from = String(query.from ?? ctx.businessDate);
    const to = String(query.to ?? ctx.businessDate);
    const range = { gte: new Date(from), lte: new Date(to) };
    const tid = tenantId(ctx);
    const [sales, expenses, incomes] = await Promise.all([
      financeRepository.salesForRange(tid, branchScope(ctx), range, ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"]),
      financeRepository.expensesForRange(tid, branchScope(ctx), range, "POSTED"),
      financeRepository.incomeForRange(tid, branchScope(ctx), range),
    ]);
    const variantIds = [...new Set(sales.flatMap((s) => s.items.map((i) => i.variantId)))];
    const costs = await financeRepository.variantCosts(tid, variantIds);
    const costMap = new Map(costs.map((c) => [c.id, num(c.cost)]));
    let cogs = 0;
    for (const s of sales) for (const i of s.items) cogs += num(i.qty) * (costMap.get(i.variantId) ?? 0);
    const revenue = sales.reduce((n, s) => n + num(s.total), 0);
    const tax = sales.reduce((n, s) => n + num(s.tax), 0);
    const otherIncome = incomes.reduce((n, r) => n + num(r.amount), 0);
    const expenseTotal = expenses.reduce((n, r) => n + num(r.amount), 0);
    const gross = revenue - cogs;
    const net = gross + otherIncome - expenseTotal;
    const byCat: Record<string, number> = {};
    for (const e of expenses) {
      const k = e.category.name;
      byCat[k] = (byCat[k] ?? 0) + num(e.amount);
    }
    return {
      from,
      to,
      revenue: money(revenue),
      cogs: money(cogs),
      grossProfit: money(gross),
      tax: money(tax),
      otherIncome: money(otherIncome),
      expenses: money(expenseTotal),
      netProfit: money(net),
      expenseBreakdown: Object.entries(byCat).map(([category, amount]) => ({ category, amount: money(amount) })),
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
      financeRepository.paymentsForRange(tid, range, branchId),
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
