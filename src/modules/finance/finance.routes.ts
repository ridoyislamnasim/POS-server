import { Router, type Request } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import { branchScope, money, num, tenantId } from "../../lib/erp.js";
import { assertBranch } from "../../lib/scope.js";
import type { AuthedRequest } from "../../types.js";
import { acceptEnum, acceptId, dateRange, ilike, parseListQuery, scopedBranchId, withPagination } from "../../lib/list-query.js";
import { enqueueOutbox } from "../outbox/enqueue.js";

export const financeRouter = Router();
financeRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

financeRouter.get("/expense-categories", requirePermission("expense.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.expenseCategory.findMany({
    where: { tenantId: tenantId(ctx) },
    orderBy: { name: "asc" },
  });
  return ok(res, rows);
});

financeRouter.post("/expense-categories", requirePermission("expense.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { name, parentId } = req.body ?? {};
  if (!name) return fail(res, "VALIDATION", "name required");
  const row = await prisma.expenseCategory.create({
    data: { tenantId: tenantId(ctx), name: String(name), parentId: parentId || null },
  });
  return ok(res, row, undefined, 201);
});

financeRouter.get("/expenses", requirePermission("expense.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "amount", "vendor", "status"], defaultSort: "createdAt", defaultOrder: "desc" });
  const status = acceptEnum(req.query.status, ["DRAFT", "POSTED", "VOIDED"] as const);
  const method = typeof req.query.method === "string" && req.query.method && req.query.method !== "ALL" ? String(req.query.method).slice(0, 32) : undefined;
  const categoryId = acceptId(req.query.categoryId);
  const branchId = scopedBranchId(ctx, req.query.branchId);
  const dates = dateRange(list.dateFrom, list.dateTo);
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    ...branchScope(ctx),
    ...(branchId ? { branchId } : {}),
    ...(status ? { status } : {}),
    ...(method ? { method } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(dates ? { businessDate: dates } : {}),
    ...(q ? { OR: [{ vendor: ilike(q) }, { notes: ilike(q) }, { category: { name: ilike(q) } }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.expense.findMany({
        where,
        include: { category: { select: { id: true, name: true } }, branch: { select: { name: true } } },
        orderBy: list.sortBy === "amount" || list.sortBy === "vendor" || list.sortBy === "status" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.expense.count({ where }),
  });
  return okList(res, rows, pagination);
});

financeRouter.post("/expenses", requirePermission("expense.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { categoryId, amount, tax, method, vendor, notes, branchId, businessDate } = req.body ?? {};
  if (!categoryId || amount == null) return fail(res, "VALIDATION", "categoryId and amount required");
  if (branchId) assertBranch(ctx, branchId);
  const row = await prisma.expense.create({
    data: {
      tenantId: tenantId(ctx),
      branchId: branchId || null,
      categoryId,
      amount: String(amount),
      tax: String(tax ?? 0),
      method: method ?? "CASH",
      vendor,
      notes,
      businessDate: new Date(businessDate || ctx.businessDate),
      createdById: ctx.userId,
      status: "POSTED",
    },
    include: { category: true },
  });
  await writeAudit({ ctx, action: "expense.create", entityType: "Expense", entityId: row.id, after: row });
  await enqueueOutbox(prisma, {
    tenantId: tenantId(ctx),
    type: "EXPENSE_CREATED",
    aggregateId: row.id,
    payload: { branchId: row.branchId, amount: row.amount, entityType: "Expense", entityId: row.id },
  });
  return ok(res, row, undefined, 201);
});

financeRouter.patch("/expenses/:id", requirePermission("expense.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.expense.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Expense not found", 404);
  if (req.body?.branchId) assertBranch(ctx, req.body.branchId);
  const row = await prisma.expense.update({
    where: { id: existing.id },
    data: {
      categoryId: req.body?.categoryId,
      amount: req.body?.amount != null ? String(req.body.amount) : undefined,
      tax: req.body?.tax != null ? String(req.body.tax) : undefined,
      method: req.body?.method,
      vendor: req.body?.vendor,
      notes: req.body?.notes,
      branchId: req.body?.branchId === "" ? null : req.body?.branchId,
    },
    include: { category: true, branch: { select: { name: true } } },
  });
  await writeAudit({ ctx, action: "expense.update", entityType: "Expense", entityId: row.id });
  return ok(res, row);
});

financeRouter.delete("/expenses/:id", requirePermission("expense.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.expense.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Expense not found", 404);
  await prisma.expense.delete({ where: { id: existing.id } });
  await writeAudit({ ctx, action: "expense.delete", entityType: "Expense", entityId: existing.id, before: existing });
  return ok(res, { id: existing.id });
});

financeRouter.get("/income", requirePermission("income.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "amount", "category"], defaultSort: "createdAt", defaultOrder: "desc" });
  const method = typeof req.query.method === "string" && req.query.method && req.query.method !== "ALL" ? String(req.query.method).slice(0, 32) : undefined;
  const dates = dateRange(list.dateFrom, list.dateTo);
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    ...branchScope(ctx),
    ...(method ? { method } : {}),
    ...(dates ? { businessDate: dates } : {}),
    ...(q ? { OR: [{ category: ilike(q) }, { notes: ilike(q) }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.income.findMany({
        where,
        include: { branch: { select: { name: true } } },
        orderBy: list.sortBy === "amount" || list.sortBy === "category" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.income.count({ where }),
  });
  return okList(res, rows, pagination);
});

financeRouter.post("/income", requirePermission("income.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { category, amount, method, notes, branchId, businessDate } = req.body ?? {};
  if (!category || amount == null) return fail(res, "VALIDATION", "category and amount required");
  if (branchId) assertBranch(ctx, branchId);
  const row = await prisma.income.create({
    data: {
      tenantId: tenantId(ctx),
      branchId: branchId || null,
      category: String(category),
      amount: String(amount),
      method: method ?? "CASH",
      notes,
      businessDate: new Date(businessDate || ctx.businessDate),
      createdById: ctx.userId,
    },
  });
  return ok(res, row, undefined, 201);
});

financeRouter.patch("/income/:id", requirePermission("income.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.income.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Income not found", 404);
  if (req.body?.branchId) assertBranch(ctx, req.body.branchId);
  const row = await prisma.income.update({
    where: { id: existing.id },
    data: {
      category: req.body?.category,
      amount: req.body?.amount != null ? String(req.body.amount) : undefined,
      method: req.body?.method,
      notes: req.body?.notes,
      branchId: req.body?.branchId === "" ? null : req.body?.branchId,
    },
    include: { branch: { select: { name: true } } },
  });
  await writeAudit({ ctx, action: "income.update", entityType: "Income", entityId: row.id });
  return ok(res, row);
});

financeRouter.delete("/income/:id", requirePermission("income.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.income.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Income not found", 404);
  await prisma.income.delete({ where: { id: existing.id } });
  await writeAudit({ ctx, action: "income.delete", entityType: "Income", entityId: existing.id, before: existing });
  return ok(res, { id: existing.id });
});

financeRouter.get("/payments", requirePermission("payment.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["createdAt", "amount", "direction"], defaultSort: "createdAt", defaultOrder: "desc" });
  const partyType = acceptEnum(req.query.partyType, ["CUSTOMER", "SUPPLIER", "OTHER"] as const);
  const partyId = acceptId(req.query.partyId);
  const method = typeof req.query.method === "string" && req.query.method && req.query.method !== "ALL" ? String(req.query.method).slice(0, 32) : undefined;
  const dates = dateRange(list.dateFrom, list.dateTo);
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    ...(partyType ? { partyType } : {}),
    ...(partyId ? { partyId } : {}),
    ...(method ? { method } : {}),
    ...(dates ? { businessDate: dates } : {}),
    ...(q ? { OR: [{ reference: ilike(q) }, { notes: ilike(q) }, { method: ilike(q) }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.ledgerPayment.findMany({
        where,
        select: {
          id: true,
          partyType: true,
          partyId: true,
          direction: true,
          amount: true,
          method: true,
          reference: true,
          notes: true,
          businessDate: true,
          createdAt: true,
        },
        orderBy: list.sortBy === "amount" || list.sortBy === "direction" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.ledgerPayment.count({ where }),
  });
  return okList(res, rows, pagination);
});

financeRouter.post("/payments", requirePermission("payment.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { partyType, partyId, direction, amount, method, reference, notes, branchId, saleId, purchaseId } = req.body ?? {};
  if (!partyType || !partyId || !direction || amount == null) {
    return fail(res, "VALIDATION", "partyType, partyId, direction, amount required");
  }
  const amt = new Prisma.Decimal(String(amount));
  if (amt.lessThanOrEqualTo(0)) return fail(res, "VALIDATION", "amount must be greater than zero");
  if (branchId) {
    try {
      assertBranch(ctx, String(branchId));
    } catch {
      return fail(res, "FORBIDDEN", "Branch not allowed", 403);
    }
  }
  const tid = tenantId(ctx);
  try {
  const row = await prisma.$transaction(async (tx) => {
    if (partyType === "CUSTOMER") {
      const customer = await tx.customer.findFirst({ where: { id: partyId, tenantId: tid } });
      if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
    }
    if (partyType === "SUPPLIER") {
      const supplier = await tx.supplier.findFirst({ where: { id: partyId, tenantId: tid } });
      if (!supplier) throw Object.assign(new Error("Supplier not found"), { code: "NOT_FOUND" });
    }
    if (saleId) {
      const sale = await tx.sale.findFirst({ where: { id: saleId, tenantId: tid } });
      if (!sale) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });
    }
    if (purchaseId) {
      const purchase = await tx.purchase.findFirst({ where: { id: purchaseId, tenantId: tid } });
      if (!purchase) throw Object.assign(new Error("Purchase not found"), { code: "NOT_FOUND" });
    }
    const pay = await tx.ledgerPayment.create({
      data: {
        tenantId: tid,
        branchId: branchId || null,
        partyType,
        partyId,
        direction,
        amount: amt,
        method: method ?? "CASH",
        reference,
        notes,
        saleId,
        purchaseId,
        businessDate: new Date(ctx.businessDate),
        createdById: ctx.userId,
      },
    });
    if (partyType === "CUSTOMER" && direction === "IN") {
      const customer = await tx.customer.findFirst({ where: { id: partyId, tenantId: tid } });
      if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
      if (saleId) {
        const sale = await tx.sale.findFirst({ where: { id: saleId, tenantId: tid } });
        if (sale) {
          const apply = Prisma.Decimal.min(amt, new Prisma.Decimal(sale.due));
          const paid = new Prisma.Decimal(sale.paid).plus(apply);
          const due = Prisma.Decimal.max(new Prisma.Decimal(sale.due).minus(apply), 0);
          await tx.sale.update({ where: { id: sale.id }, data: { paid, due } });
        }
      }
      const nextDue = Prisma.Decimal.max(new Prisma.Decimal(customer.creditDue).minus(amt), 0);
      await tx.customer.update({
        where: { id: customer.id },
        data: { creditDue: nextDue },
      });
    }
    if (partyType === "SUPPLIER" && direction === "OUT") {
      const supplier = await tx.supplier.findFirst({ where: { id: partyId, tenantId: tid } });
      if (!supplier) throw Object.assign(new Error("Supplier not found"), { code: "NOT_FOUND" });
      const nextDue = Prisma.Decimal.max(new Prisma.Decimal(supplier.creditDue).minus(amt), 0);
      await tx.supplier.update({
        where: { id: supplier.id },
        data: { creditDue: nextDue },
      });
      if (purchaseId) {
        const p = await tx.purchase.findFirst({ where: { id: purchaseId, tenantId: tid } });
        if (p) {
          const paid = new Prisma.Decimal(p.paid).plus(amt);
          const due = Prisma.Decimal.max(new Prisma.Decimal(p.total).minus(paid), 0);
          await tx.purchase.update({ where: { id: p.id }, data: { paid, due } });
        }
      }
    }
    if (direction === "IN") {
      await enqueueOutbox(tx, {
        tenantId: tid,
        type: "PAYMENT_RECEIVED",
        aggregateId: pay.id,
        payload: { branchId: branchId || null, amount: String(amt), partyType, entityType: "LedgerPayment", entityId: pay.id },
      });
    }
    return pay;
  });
  await writeAudit({ ctx, action: "payment.create", entityType: "LedgerPayment", entityId: row.id });
  return ok(res, row, undefined, 201);
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "NOT_FOUND") return fail(res, "NOT_FOUND", err.message, 404);
    throw e;
  }
});

financeRouter.get("/customer-dues", requirePermission("finance.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["creditDue", "name"], defaultSort: "creditDue", defaultOrder: "desc" });
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    creditDue: { gt: 0 },
    ...(q ? { OR: [{ name: ilike(q) }, { phone: { contains: q } }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.customer.findMany({
        where,
        select: { id: true, name: true, phone: true, creditDue: true, creditLimit: true },
        orderBy: { [list.sortBy]: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.customer.count({ where }),
  });
  return okList(res, rows, pagination);
});

financeRouter.get("/supplier-dues", requirePermission("finance.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["creditDue", "name"], defaultSort: "creditDue", defaultOrder: "desc" });
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    creditDue: { gt: 0 },
    ...(q ? { OR: [{ name: ilike(q) }, { phone: { contains: q } }] } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.supplier.findMany({
        where,
        select: { id: true, name: true, phone: true, creditDue: true },
        orderBy: { [list.sortBy]: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.supplier.count({ where }),
  });
  return okList(res, rows, pagination);
});

financeRouter.get("/cash-flow", requirePermission("finance.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const from = String(req.query.from ?? ctx.businessDate);
  const to = String(req.query.to ?? ctx.businessDate);
  const range = { gte: new Date(from), lte: new Date(to) };
  const tid = tenantId(ctx);
  const scope = branchScope(ctx);
  const [sales, expenses, incomes, pays] = await Promise.all([
    prisma.sale.findMany({
      where: { tenantId: tid, ...scope, businessDate: range, status: { in: ["COMPLETED", "PARTIALLY_RETURNED"] } },
      include: { payments: true },
    }),
    prisma.expense.findMany({ where: { tenantId: tid, ...scope, businessDate: range, status: "POSTED" } }),
    prisma.income.findMany({ where: { tenantId: tid, ...scope, businessDate: range } }),
    prisma.ledgerPayment.findMany({ where: { tenantId: tid, businessDate: range } }),
  ]);
  const inflows =
    sales.flatMap((s) => s.payments).filter((p) => p.status === "CAPTURED").reduce((n, p) => n + num(p.amount), 0) +
    incomes.reduce((n, r) => n + num(r.amount), 0) +
    pays.filter((p) => p.direction === "IN").reduce((n, p) => n + num(p.amount), 0);
  const outflows =
    expenses.reduce((n, r) => n + num(r.amount), 0) +
    pays.filter((p) => p.direction === "OUT").reduce((n, p) => n + num(p.amount), 0);
  return ok(res, {
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
  });
});

financeRouter.get("/profit-loss", requirePermission("report.finance"), async (req, res) => {
  const ctx = ctxOf(req);
  const from = String(req.query.from ?? ctx.businessDate);
  const to = String(req.query.to ?? ctx.businessDate);
  const range = { gte: new Date(from), lte: new Date(to) };
  const tid = tenantId(ctx);
  const sales = await prisma.sale.findMany({
    where: { tenantId: tid, ...branchScope(ctx), businessDate: range, status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] } },
    include: { items: true },
  });
  const expenses = await prisma.expense.findMany({
    where: { tenantId: tid, ...branchScope(ctx), businessDate: range, status: "POSTED" },
    include: { category: true },
  });
  const incomes = await prisma.income.findMany({
    where: { tenantId: tid, ...branchScope(ctx), businessDate: range },
  });
  const variantIds = [...new Set(sales.flatMap((s) => s.items.map((i) => i.variantId)))];
  const costs = await prisma.productVariant.findMany({
    where: { tenantId: tid, id: { in: variantIds } },
    select: { id: true, cost: true },
  });
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
  return ok(res, {
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
  });
});

financeRouter.get("/daily-closing", requirePermission("finance.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["businessDate", "createdAt"], defaultSort: "businessDate", defaultOrder: "desc" });
  const branchId = scopedBranchId(ctx, req.query.branchId);
  const dates = dateRange(list.dateFrom, list.dateTo);
  const where = {
    tenantId: tenantId(ctx),
    ...branchScope(ctx),
    ...(branchId ? { branchId } : {}),
    ...(dates ? { businessDate: dates } : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.dailyClosing.findMany({
        where,
        include: { branch: { select: { name: true } } },
        orderBy: { businessDate: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.dailyClosing.count({ where }),
  });
  return okList(res, rows, pagination);
});

financeRouter.post("/daily-closing", requirePermission("shift.close"), async (req, res) => {
  const ctx = ctxOf(req);
  const { branchId, countedCash, openingCash, notes } = req.body ?? {};
  if (!branchId || countedCash == null) return fail(res, "VALIDATION", "branchId and countedCash required");
  assertBranch(ctx, branchId);
  const date = new Date(ctx.businessDate);
  const tid = tenantId(ctx);
  const range = { gte: date, lte: date };
  const [sales, expenses, incomes, pays] = await Promise.all([
    prisma.sale.findMany({
      where: { tenantId: tid, branchId, businessDate: range, status: { in: ["COMPLETED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] } },
      include: { payments: true },
    }),
    prisma.expense.findMany({ where: { tenantId: tid, branchId, businessDate: range, status: "POSTED" } }),
    prisma.income.findMany({ where: { tenantId: tid, branchId, businessDate: range } }),
    prisma.ledgerPayment.findMany({ where: { tenantId: tid, branchId, businessDate: range } }),
  ]);
  const salesCash = sales.flatMap((s) => s.payments).filter((p) => p.method.toUpperCase() === "CASH" && p.status === "CAPTURED").reduce((n, p) => n + num(p.amount), 0);
  const refundCash = sales.flatMap((s) => s.payments).filter((p) => p.method.toUpperCase() === "CASH" && (p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED")).reduce((n, p) => n + num(p.amount), 0);
  const expenseCash = expenses.filter((e) => e.method.toUpperCase() === "CASH").reduce((n, e) => n + num(e.amount), 0);
  const incomeCash = incomes.filter((e) => e.method.toUpperCase() === "CASH").reduce((n, e) => n + num(e.amount), 0);
  const paymentsIn = pays.filter((p) => p.direction === "IN" && p.method.toUpperCase() === "CASH").reduce((n, p) => n + num(p.amount), 0);
  const paymentsOut = pays.filter((p) => p.direction === "OUT" && p.method.toUpperCase() === "CASH").reduce((n, p) => n + num(p.amount), 0);
  const open = num(openingCash ?? 0);
  const expected = open + salesCash + incomeCash + paymentsIn - expenseCash - paymentsOut - refundCash;
  const counted = num(countedCash);
  const row = await prisma.dailyClosing.upsert({
    where: { tenantId_branchId_businessDate: { tenantId: tid, branchId, businessDate: date } },
    create: {
      tenantId: tid,
      branchId,
      businessDate: date,
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
    update: {
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
    include: { branch: true },
  });
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
  return ok(res, row, undefined, 201);
});
