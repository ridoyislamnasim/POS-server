import { Prisma } from "@prisma/client";
import { writeAudit } from "../../lib/audit.js";
import { branchScope, tenantId } from "../../lib/erp.js";
import { prisma } from "../../lib/prisma.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import {
  acceptEnum,
  acceptId,
  dateRange,
  ilike,
  parseListQuery,
  scopedBranchId,
  withPagination,
} from "../../lib/list-query.js";
import { assertBranch } from "../../lib/scope.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { financeRepository } from "./finance.repository.js";
import type {
  CreateExpenseCategoryInput,
  CreateExpenseInput,
  CreateIncomeInput,
  CreatePaymentInput,
  UpdateExpenseInput,
  UpdateIncomeInput,
} from "./finance.types.js";

function toNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function resolveExpenseAmounts(input: {
  amount?: unknown;
  subtotal?: unknown;
  tax?: unknown;
  taxAmount?: unknown;
  totalAmount?: unknown;
}): { subtotal: number; taxAmount: number; totalAmount: number } {
  const subRaw = input.subtotal != null ? toNum(input.subtotal) : input.amount != null ? toNum(input.amount) : null;
  if (subRaw == null) throw new AppError("VALIDATION", "categoryId and amount required", 400);
  const taxRaw = input.taxAmount != null ? toNum(input.taxAmount) : input.tax != null ? toNum(input.tax) : 0;
  if (subRaw < 0 || taxRaw < 0) throw new AppError("VALIDATION", "amounts must be >= 0", 400);
  let total: number;
  if (input.totalAmount != null) {
    total = toNum(input.totalAmount);
    if (Math.abs(total - (subRaw + taxRaw)) > 0.0001) {
      throw new AppError("VALIDATION", `totalAmount ${total} must equal subtotal ${subRaw} + taxAmount ${taxRaw}`, 400);
    }
  } else {
    total = subRaw + taxRaw;
  }
  if (total <= 0) throw new AppError("VALIDATION", "totalAmount must be greater than zero", 400);
  return { subtotal: subRaw, taxAmount: taxRaw, totalAmount: total };
}

function validateJournalLine(l: { debit: number; credit: number }) {
  const d = toNum(l.debit);
  const c = toNum(l.credit);
  if (d < 0 || c < 0) throw new AppError("VALIDATION", "Journal line debit/credit must be >= 0", 400);
  const hasDebit = d > 0;
  const hasCredit = c > 0;
  if (hasDebit === hasCredit) throw new AppError("VALIDATION", "Journal line must have either debit or credit, not both/none", 400);
}

async function createExpenseJournal(
  tx: Prisma.TransactionClient,
  opts: {
    tenantId: string;
    branchId: string | null;
    businessDate: Date;
    expenseId: string;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    taxRecoverable: boolean;
    paymentAccountId: string | null;
    categoryId: string;
    createdById: string;
  },
) {
  // Resolve COA accounts — graceful skip if not seeded
  const anyTx = tx as never as {
    chartAccount: { findFirst: (a: unknown) => Promise<{ id: string } | null> };
    journalEntry: { create: (a: unknown) => Promise<{ id: string }> };
    journalLine: { create: (a: unknown) => Promise<unknown> };
  };
  // Prefer payment-account linked COA, else fallback to generic cash/bank placeholder
  let creditAccountId: string | null = null;
  if (opts.paymentAccountId) {
    const pa = await (tx as never as { paymentAccount: { findFirst: (a: unknown) => Promise<{ coaAccountId: string | null } | null> } }).paymentAccount.findFirst({
      where: { id: opts.paymentAccountId },
    } as never);
    if (pa?.coaAccountId) creditAccountId = pa.coaAccountId;
  }
  if (!creditAccountId) {
    const fallback = await anyTx.chartAccount.findFirst({
      where: { tenantId: opts.tenantId, type: { in: ["ASSET"] as never }, isActive: true },
    });
    if (!fallback) return; // COA not seeded yet
    creditAccountId = fallback.id;
  }
  const expenseAccount = await anyTx.chartAccount.findFirst({
    where: { tenantId: opts.tenantId, type: "EXPENSE", isActive: true },
  });
  if (!expenseAccount) return;
  let taxAccount: { id: string } | null = null;
  if (opts.taxRecoverable && opts.taxAmount > 0) {
    taxAccount = await anyTx.chartAccount.findFirst({
      where: { tenantId: opts.tenantId, type: "TAX", isActive: true },
    });
  }

  const entry = await anyTx.journalEntry.create({
    data: {
      tenantId: opts.tenantId,
      branchId: opts.branchId,
      businessDate: opts.businessDate,
      sourceType: "EXPENSE",
      sourceId: opts.expenseId,
      status: "POSTED",
      memo: `Expense ${opts.expenseId}`,
      createdById: opts.createdById,
    } as never,
  });

  const lines: Array<{ accountId: string; debit: number; credit: number; memo?: string }> = [];
  if (opts.taxRecoverable && opts.taxAmount > 0 && taxAccount) {
    lines.push({ accountId: expenseAccount.id, debit: opts.subtotal, credit: 0, memo: "Expense" });
    lines.push({ accountId: taxAccount.id, debit: opts.taxAmount, credit: 0, memo: "Input VAT" });
    lines.push({ accountId: creditAccountId, debit: 0, credit: opts.totalAmount, memo: "Payment" });
  } else {
    lines.push({ accountId: expenseAccount.id, debit: opts.totalAmount, credit: 0, memo: "Expense" });
    lines.push({ accountId: creditAccountId, debit: 0, credit: opts.totalAmount, memo: "Payment" });
  }

  let totD = 0;
  let totC = 0;
  for (const l of lines) {
    validateJournalLine(l);
    totD += l.debit;
    totC += l.credit;
    await anyTx.journalLine.create({
      data: {
        journalEntryId: entry.id,
        accountId: l.accountId,
        debit: String(l.debit),
        credit: String(l.credit),
        memo: l.memo,
      } as never,
    });
  }
  if (Math.abs(totD - totC) > 0.0001) throw new AppError("VALIDATION", "Journal totalDebit must equal totalCredit", 400);
}

/**
 * Finance CRUD business logic (categories/expenses/income/payments/dues).
 * No Express `req`/`res` here. Reporting/closing lives in
 * `finance.closing.service.ts`.
 */
export const financeService = {
  listExpenseCategories(ctx: RequestContext) {
    return financeRepository.listExpenseCategories(tenantId(ctx));
  },

  async createExpenseCategory(ctx: RequestContext, input: CreateExpenseCategoryInput) {
    if (!input.name) throw new AppError("VALIDATION", "name required", 400);
    if (input.parentId) {
      const parent = await financeRepository.findExpenseCategory(tenantId(ctx), input.parentId);
      if (!parent) throw new AppError("VALIDATION", "Parent category not found", 400);
    }
    try {
      return await financeRepository.createExpenseCategory(tenantId(ctx), input.name.trim(), input.parentId);
    } catch (e: unknown) {
      const err = e as { code?: string; meta?: { target?: string[] } };
      if (err.code === "P2002") throw new AppError("CONFLICT", "Category name already exists", 409);
      throw e;
    }
  },

  async updateExpenseCategory(ctx: RequestContext, id: string, input: { name?: string; parentId?: string | null }) {
    const existing = await financeRepository.findExpenseCategory(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Category not found", 404);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) {
      const n = String(input.name).trim();
      if (!n) throw new AppError("VALIDATION", "name required", 400);
      data.name = n;
    }
    if (input.parentId !== undefined) {
      if (input.parentId === id) throw new AppError("VALIDATION", "Category cannot be its own parent", 400);
      if (input.parentId) {
        const parent = await financeRepository.findExpenseCategory(tenantId(ctx), input.parentId);
        if (!parent) throw new AppError("VALIDATION", "Parent category not found", 400);
        // prevent cycles: parent cannot be descendant of current
        let cur: string | null = parent.parentId ?? null;
        while (cur) {
          if (cur === id) throw new AppError("VALIDATION", "Cyclic category hierarchy", 400);
          const anc = await financeRepository.findExpenseCategory(tenantId(ctx), cur);
          cur = anc?.parentId ?? null;
        }
        data.parentId = input.parentId;
      } else {
        data.parentId = null;
      }
    }
    try {
      return await financeRepository.updateExpenseCategory(existing.id, data);
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err.code === "P2002") throw new AppError("CONFLICT", "Category name already exists", 409);
      throw e;
    }
  },

  async deleteExpenseCategory(ctx: RequestContext, id: string) {
    const existing = await financeRepository.findExpenseCategory(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Category not found", 404);
    const childCount = await financeRepository.countExpenseCategoryChildren(existing.id);
    if (childCount > 0) throw new AppError("VALIDATION", "Cannot delete category with subcategories", 400);
    const expenseCount = await financeRepository.countExpensesByCategoryId(existing.id);
    if (expenseCount > 0) throw new AppError("VALIDATION", "Cannot delete category with expenses", 400);
    await financeRepository.deleteExpenseCategory(existing.id);
    await writeAudit({ ctx, action: "expenseCategory.delete", entityType: "ExpenseCategory", entityId: existing.id, before: existing });
    return { id: existing.id };
  },

  async listExpenses(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "amount", "vendor", "status"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const status = acceptEnum(query.status, ["DRAFT", "POSTED", "VOIDED"] as const);
    const method =
      typeof query.method === "string" && query.method && query.method !== "ALL"
        ? String(query.method).slice(0, 32)
        : undefined;
    const categoryId = acceptId(query.categoryId);
    const branchId = scopedBranchId(ctx, query.branchId);
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
    return withPagination(list, {
      find: (skip, take) =>
        financeRepository.listExpenses({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "amount" || list.sortBy === "vendor" || list.sortBy === "status"
              ? { [list.sortBy]: list.sortOrder }
              : { createdAt: list.sortOrder },
        }),
      count: () => financeRepository.countExpenses(where),
    });
  },

  async createExpense(ctx: RequestContext, input: CreateExpenseInput) {
    const {
      categoryId,
      amount,
      subtotal,
      tax,
      taxAmount,
      totalAmount,
      taxRecoverable: taxRecoverableInput,
      method,
      paymentAccountId,
      vendor,
      vendorId,
      notes,
      branchId,
      businessDate,
    } = input;
    if (!categoryId) throw new AppError("VALIDATION", "categoryId and amount required", 400);
    if (branchId) assertBranch(ctx, branchId);
    const tid = tenantId(ctx);

    // Resolve amounts: subtotal + taxAmount = totalAmount. amount is deprecated alias for totalAmount.
    const resolved = resolveExpenseAmounts({ amount, subtotal, tax, taxAmount, totalAmount });
    const { subtotal: sub, taxAmount: taxAmt, totalAmount: tot } = resolved;

    // Hierarchy: explicit per expense → TenantAccountingSettings.defaultTaxRecoverable → false
    let taxRecoverable: boolean;
    if (typeof taxRecoverableInput === "boolean") taxRecoverable = taxRecoverableInput;
    else {
      const settings = await (prisma as never as { tenantAccountingSettings: { findUnique: (a: unknown) => Promise<{ defaultTaxRecoverable: boolean } | null> } }).tenantAccountingSettings.findUnique({
        where: { tenantId: tid },
      } as never);
      taxRecoverable = settings?.defaultTaxRecoverable ?? false;
    }

    // PaymentAccount → method derivation, enforce consistency
    let resolvedMethod = method ?? "CASH";
    let resolvedPaymentAccountId: string | null = paymentAccountId || null;
    if (paymentAccountId) {
      const pa = await (prisma as never as { paymentAccount: { findFirst: (a: unknown) => Promise<{ id: string; tenantId: string; type: string } | null> } }).paymentAccount.findFirst({
        where: { id: paymentAccountId, tenantId: tid },
      } as never);
      if (!pa) throw new AppError("VALIDATION", "Payment account not found", 400);
      resolvedMethod = pa.type;
      resolvedPaymentAccountId = pa.id;
      if (method && method !== pa.type) {
        throw new AppError("VALIDATION", `method ${method} does not match payment account type ${pa.type}`, 400);
      }
    }

    if (vendorId) {
      const sup = await prisma.supplier.findFirst({ where: { id: vendorId, tenantId: tid } });
      if (!sup) throw new AppError("VALIDATION", "Supplier not found", 400);
    }

    // Transaction: Expense + Journal (Phase 5) + audit/outbox
    const row = await prisma.$transaction(async (tx) => {
      const expense = await tx.expense.create({
        data: {
          tenantId: tid,
          branchId: branchId || null,
          categoryId,
          // legacy columns for back-compat
          amount: String(tot),
          tax: String(taxAmt),
          subtotal: String(sub),
          taxAmount: String(taxAmt),
          totalAmount: String(tot),
          taxRecoverable,
          method: resolvedMethod,
          paymentAccountId: resolvedPaymentAccountId,
          vendor: vendor ?? null,
          vendorId: vendorId ?? null,
          notes: notes ?? null,
          businessDate: new Date((businessDate as string) || ctx.businessDate),
          createdById: ctx.userId,
          status: "POSTED",
        } as never,
        include: { category: true } as never,
      } as never);

      // Best-effort journal posting (Phase 5): if COA accounts missing, skip gracefully
      try {
        await createExpenseJournal(tx, {
          tenantId: tid,
          branchId: branchId || null,
          businessDate: new Date((businessDate as string) || ctx.businessDate),
          expenseId: (expense as { id: string }).id,
          subtotal: sub,
          taxAmount: taxAmt,
          totalAmount: tot,
          taxRecoverable,
          paymentAccountId: resolvedPaymentAccountId,
          categoryId,
          createdById: ctx.userId,
        });
      } catch (e) {
        // Journal is accounting-level; don't fail expense if COA not yet seeded. Log via audit.
        // Re-throw validation errors (e.g. unbalanced) but swallow "COA missing" gracefully.
        const msg = (e as Error).message ?? "";
        if (msg.includes("Journal") || msg.includes("balanced") || msg.includes("ChartAccount")) throw e;
      }

      return expense;
    });

    await writeAudit({ ctx, action: "expense.create", entityType: "Expense", entityId: (row as { id: string }).id, after: row });
    await enqueueOutbox(prisma, {
      tenantId: tid,
      type: "EXPENSE_CREATED",
      aggregateId: (row as { id: string }).id,
      payload: {
        branchId: (row as { branchId: string | null }).branchId,
        amount: String(tot),
        subtotal: String(sub),
        taxAmount: String(taxAmt),
        totalAmount: String(tot),
        entityType: "Expense",
        entityId: (row as { id: string }).id,
      },
    });
    return row;
  },

  async updateExpense(ctx: RequestContext, id: string, input: UpdateExpenseInput) {
    const existing = await financeRepository.findExpense(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Expense not found", 404);
    if ((existing as { status: string }).status === "VOIDED") {
      throw new AppError("VALIDATION", "Cannot update voided expense", 400);
    }
    if (input.branchId) assertBranch(ctx, input.branchId);
    // For POSTED, allow patch but recalc amounts if any amount fields supplied
    const patch: Record<string, unknown> = {
      categoryId: input.categoryId,
      vendor: input.vendor,
      notes: input.notes,
      branchId: input.branchId === "" ? null : input.branchId,
      paymentAccountId: input.paymentAccountId === "" ? null : input.paymentAccountId,
      vendorId: input.vendorId === "" ? null : input.vendorId,
    };
    // amount fields: if any supplied, re-resolve and update legacy + new columns
    if (
      input.amount != null ||
      input.subtotal != null ||
      input.tax != null ||
      input.taxAmount != null ||
      input.totalAmount != null
    ) {
      const cur = existing as unknown as { amount: unknown; tax: unknown; subtotal: unknown; taxAmount: unknown; totalAmount: unknown };
      const resolved = resolveExpenseAmounts({
        amount: input.amount ?? cur.totalAmount ?? cur.amount,
        subtotal: input.subtotal ?? cur.subtotal,
        tax: input.tax ?? cur.tax,
        taxAmount: input.taxAmount ?? cur.taxAmount,
        totalAmount: input.totalAmount ?? cur.totalAmount,
      });
      patch.amount = String(resolved.totalAmount);
      patch.tax = String(resolved.taxAmount);
      patch.subtotal = String(resolved.subtotal);
      patch.taxAmount = String(resolved.taxAmount);
      patch.totalAmount = String(resolved.totalAmount);
    }
    if (typeof input.taxRecoverable === "boolean") patch.taxRecoverable = input.taxRecoverable;
    if (input.method) patch.method = input.method;
    // if paymentAccountId changed, re-derive method consistency
    if (input.paymentAccountId) {
      const pa = await (prisma as never as { paymentAccount: { findFirst: (a: unknown) => Promise<{ id: string; type: string; tenantId: string } | null> } }).paymentAccount.findFirst({
        where: { id: input.paymentAccountId, tenantId: tenantId(ctx) },
      } as never);
      if (!pa) throw new AppError("VALIDATION", "Payment account not found", 400);
      patch.paymentAccountId = pa.id;
      patch.method = pa.type;
      if (input.method && input.method !== pa.type) {
        throw new AppError("VALIDATION", `method ${input.method} does not match payment account type ${pa.type}`, 400);
      }
    }
    if (input.vendorId) {
      const sup = await prisma.supplier.findFirst({ where: { id: input.vendorId, tenantId: tenantId(ctx) } });
      if (!sup) throw new AppError("VALIDATION", "Supplier not found", 400);
    }
    const row = await financeRepository.updateExpense(existing.id, patch);
    await writeAudit({ ctx, action: "expense.update", entityType: "Expense", entityId: row.id });
    return row;
  },

  async deleteExpense(ctx: RequestContext, id: string) {
    const existing = await financeRepository.findExpense(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Expense not found", 404);
    const status = (existing as { status: string }).status;
    // Phase 2: POSTED must be voided, not hard-deleted. Only DRAFT can be deleted.
    if (status === "POSTED") {
      throw new AppError("VALIDATION", "Posted expense must be voided, not deleted. Use POST /expenses/:id/void", 400);
    }
    if (status === "VOIDED") {
      throw new AppError("VALIDATION", "Voided expense cannot be deleted", 400);
    }
    await financeRepository.deleteExpense(existing.id);
    await writeAudit({ ctx, action: "expense.delete", entityType: "Expense", entityId: existing.id, before: existing });
    return { id: existing.id };
  },

  async voidExpense(ctx: RequestContext, id: string) {
    const existing = await financeRepository.findExpense(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Expense not found", 404);
    if ((existing as { status: string }).status === "VOIDED") {
      throw new AppError("VALIDATION", "Expense already voided", 400);
    }
    if ((existing as { status: string }).status !== "POSTED") {
      throw new AppError("VALIDATION", "Only POSTED expense can be voided", 400);
    }
    const tid = tenantId(ctx);
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.expense.update({
        where: { id: existing.id },
        data: { status: "VOIDED" } as never,
        include: { category: true } as never,
      } as never);

      // Reversal journal (Phase 5): find original journal and reverse
      const original = await (tx as never as { journalEntry: { findFirst: (a: unknown) => Promise<{ id: string } | null> } }).journalEntry.findFirst({
        where: { tenantId: tid, sourceType: "EXPENSE", sourceId: existing.id },
      } as never);
      if (original) {
        const lines = await (tx as never as { journalLine: { findMany: (a: unknown) => Promise<Array<{ accountId: string; debit: unknown; credit: unknown; memo: string | null }>> } }).journalLine.findMany({
          where: { journalEntryId: (original as { id: string }).id },
        } as never);
        const reversal = await (tx as never as { journalEntry: { create: (a: unknown) => Promise<{ id: string }> } }).journalEntry.create({
          data: {
            tenantId: tid,
            branchId: (existing as { branchId: string | null }).branchId,
            businessDate: new Date((existing as { businessDate: Date }).businessDate),
            sourceType: "EXPENSE_REVERSAL",
            sourceId: existing.id,
            status: "REVERSED",
            reversesId: (original as { id: string }).id,
            memo: `Reversal for expense ${existing.id}`,
            createdById: ctx.userId,
          } as never,
        } as never);
        for (const l of lines as Array<{ accountId: string; debit: unknown; credit: unknown }>) {
          const d = Number(l.debit ?? 0);
          const c = Number(l.credit ?? 0);
          // validate XOR before swap
          validateJournalLine({ debit: d, credit: c });
          await (tx as never as { journalLine: { create: (a: unknown) => Promise<unknown> } }).journalLine.create({
            data: {
              journalEntryId: (reversal as { id: string }).id,
              accountId: l.accountId,
              debit: String(c),
              credit: String(d),
              memo: "Reversal",
            } as never,
          } as never);
        }
        // verify reversed entry balanced
        const totD = (lines as Array<{ debit: unknown; credit: unknown }>).reduce((s, x) => s + Number(x.credit ?? 0), 0);
        const totC = (lines as Array<{ debit: unknown; credit: unknown }>).reduce((s, x) => s + Number(x.debit ?? 0), 0);
        if (Math.abs(totD - totC) > 0.0001) throw new AppError("VALIDATION", "Reversal journal unbalanced", 400);
      }

      return updated;
    });

    await writeAudit({ ctx, action: "expense.void", entityType: "Expense", entityId: existing.id, before: existing, after: row });
    await enqueueOutbox(prisma, {
      tenantId: tid,
      type: "EXPENSE_VOIDED",
      aggregateId: existing.id,
      payload: { entityType: "Expense", entityId: existing.id },
    });
    return row;
  },

  async listIncome(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "amount", "category"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const method =
      typeof query.method === "string" && query.method && query.method !== "ALL"
        ? String(query.method).slice(0, 32)
        : undefined;
    const dates = dateRange(list.dateFrom, list.dateTo);
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      ...(method ? { method } : {}),
      ...(dates ? { businessDate: dates } : {}),
      ...(q ? { OR: [{ category: ilike(q) }, { notes: ilike(q) }] } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        financeRepository.listIncome({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "amount" || list.sortBy === "category"
              ? { [list.sortBy]: list.sortOrder }
              : { createdAt: list.sortOrder },
        }),
      count: () => financeRepository.countIncome(where),
    });
  },

  async createIncome(ctx: RequestContext, input: CreateIncomeInput) {
    const { category, amount, method, notes, branchId, businessDate } = input;
    if (!category || amount == null) throw new AppError("VALIDATION", "category and amount required", 400);
    if (branchId) assertBranch(ctx, branchId);
    return financeRepository.createIncome({
      tenantId: tenantId(ctx),
      branchId: branchId || null,
      category: String(category),
      amount: String(amount),
      method: method ?? "CASH",
      notes,
      businessDate: new Date(businessDate || ctx.businessDate),
      createdById: ctx.userId,
    });
  },

  async updateIncome(ctx: RequestContext, id: string, input: UpdateIncomeInput) {
    const existing = await financeRepository.findIncome(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Income not found", 404);
    if (input.branchId) assertBranch(ctx, input.branchId);
    const row = await financeRepository.updateIncome(existing.id, {
      category: input.category,
      amount: input.amount != null ? String(input.amount) : undefined,
      method: input.method,
      notes: input.notes,
      branchId: input.branchId === "" ? null : input.branchId,
    });
    await writeAudit({ ctx, action: "income.update", entityType: "Income", entityId: row.id });
    return row;
  },

  async deleteIncome(ctx: RequestContext, id: string) {
    const existing = await financeRepository.findIncome(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Income not found", 404);
    await financeRepository.deleteIncome(existing.id);
    await writeAudit({ ctx, action: "income.delete", entityType: "Income", entityId: existing.id, before: existing });
    return { id: existing.id };
  },

  async listPayments(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "amount", "direction"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const partyType = acceptEnum(query.partyType, ["CUSTOMER", "SUPPLIER", "OTHER"] as const);
    const partyId = acceptId(query.partyId);
    const method =
      typeof query.method === "string" && query.method && query.method !== "ALL"
        ? String(query.method).slice(0, 32)
        : undefined;
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
    return withPagination(list, {
      find: (skip, take) =>
        financeRepository.listPayments({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "amount" || list.sortBy === "direction"
              ? { [list.sortBy]: list.sortOrder }
              : { createdAt: list.sortOrder },
        }),
      count: () => financeRepository.countPayments(where),
    });
  },

  async createPayment(ctx: RequestContext, input: CreatePaymentInput) {
    const { partyType, partyId, direction, amount, method, reference, notes, branchId, saleId, purchaseId } = input;
    if (!partyType || !partyId || !direction || amount == null) {
      throw new AppError("VALIDATION", "partyType, partyId, direction, amount required", 400);
    }
    const amt = new Prisma.Decimal(String(amount));
    if (amt.lessThanOrEqualTo(0)) throw new AppError("VALIDATION", "amount must be greater than zero", 400);
    if (branchId) {
      try {
        assertBranch(ctx, String(branchId));
      } catch {
        throw new AppError("FORBIDDEN", "Branch not allowed", 403);
      }
    }
    const tid = tenantId(ctx);
    try {
      const row = await financeRepository.createPaymentApplied({
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
      });
      await writeAudit({ ctx, action: "payment.create", entityType: "LedgerPayment", entityId: row.id });
      return row;
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "NOT_FOUND") throw new AppError("NOT_FOUND", err.message, 404);
      throw e;
    }
  },

  async listCustomerDues(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["creditDue", "name"],
      defaultSort: "creditDue",
      defaultOrder: "desc",
    });
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      creditDue: { gt: 0 },
      ...(q ? { OR: [{ name: ilike(q) }, { phone: { contains: q } }] } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        financeRepository.listCustomerDues({ where, skip, take, orderBy: { [list.sortBy]: list.sortOrder } }),
      count: () => financeRepository.countCustomerDues(where),
    });
  },

  async listSupplierDues(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["creditDue", "name"],
      defaultSort: "creditDue",
      defaultOrder: "desc",
    });
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      creditDue: { gt: 0 },
      ...(q ? { OR: [{ name: ilike(q) }, { phone: { contains: q } }] } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        financeRepository.listSupplierDues({ where, skip, take, orderBy: { [list.sortBy]: list.sortOrder } }),
      count: () => financeRepository.countSupplierDues(where),
    });
  },

  // -- payment accounts (Phase 4)
  async listPaymentAccounts(ctx: RequestContext) {
    const tid = tenantId(ctx);
    const where: Record<string, unknown> = { tenantId: tid };
    if (!ctx.allBranches && !ctx.isPlatform) {
      if (ctx.branchIds.length) (where as { branchId?: unknown }).branchId = { in: ctx.branchIds };
      else (where as { branchId?: unknown }).branchId = null;
    }
    return (prisma as never as { paymentAccount: { findMany: (a: unknown) => Promise<unknown[]> } }).paymentAccount.findMany({
      where,
      orderBy: { name: "asc" },
      include: { coaAccount: { select: { id: true, name: true, code: true } } },
    } as never);
  },

  async createPaymentAccount(ctx: RequestContext, input: { name: string; type: string; branchId?: string; coaAccountId?: string }) {
    if (!input.name) throw new AppError("VALIDATION", "name required", 400);
    const valid = ["CASH", "BANK", "MFS", "CARD"] as const;
    if (!valid.includes(input.type as (typeof valid)[number])) throw new AppError("VALIDATION", "invalid type", 400);
    if (input.branchId) assertBranch(ctx, input.branchId);
    const tid = tenantId(ctx);
    if (input.coaAccountId) {
      const coa = await (prisma as never as { chartAccount: { findFirst: (a: unknown) => Promise<unknown | null> } }).chartAccount.findFirst({
        where: { id: input.coaAccountId, tenantId: tid },
      } as never);
      if (!coa) throw new AppError("VALIDATION", "Chart account not found", 400);
    }
    const row = await (prisma as never as { paymentAccount: { create: (a: unknown) => Promise<unknown> } }).paymentAccount.create({
      data: {
        tenantId: tid,
        branchId: input.branchId || null,
        name: String(input.name),
        type: input.type as never,
        coaAccountId: input.coaAccountId || null,
      } as never,
    } as never);
    await writeAudit({ ctx, action: "paymentAccount.create", entityType: "PaymentAccount", entityId: (row as { id: string }).id, after: row });
    return row;
  },

  async getTenantAccountingSettings(ctx: RequestContext) {
    const tid = tenantId(ctx);
    const row = await (prisma as never as { tenantAccountingSettings: { findUnique: (a: unknown) => Promise<unknown | null> } }).tenantAccountingSettings.findUnique({
      where: { tenantId: tid },
    } as never);
    if (row) return row;
    return (prisma as never as { tenantAccountingSettings: { create: (a: unknown) => Promise<unknown> } }).tenantAccountingSettings.create({
      data: { tenantId: tid, defaultTaxRecoverable: false } as never,
    } as never);
  },

  async updateTenantAccountingSettings(ctx: RequestContext, input: { defaultTaxRecoverable?: boolean; useLedgerReports?: boolean }) {
    const tid = tenantId(ctx);
    const data: Record<string, unknown> = {};
    if (typeof input.defaultTaxRecoverable === "boolean") data.defaultTaxRecoverable = input.defaultTaxRecoverable;
    if (typeof input.useLedgerReports === "boolean") data.useLedgerReports = input.useLedgerReports;
    const row = await (prisma as never as { tenantAccountingSettings: { upsert: (a: unknown) => Promise<unknown> } }).tenantAccountingSettings.upsert({
      where: { tenantId: tid },
      create: { tenantId: tid, defaultTaxRecoverable: data.defaultTaxRecoverable ?? false, useLedgerReports: data.useLedgerReports ?? false } as never,
      update: data as never,
    } as never);
    await writeAudit({ ctx, action: "tenantAccountingSettings.update", entityType: "TenantAccountingSettings", entityId: tid, after: row });
    return row;
  },

  async reconcileExpenses(ctx: RequestContext) {
    const tid = tenantId(ctx);
    const scope = branchScope(ctx);
    // Σ Expense.totalAmount (POSTED only, VOIDED excluded)
    const expenses = (await prisma.expense.findMany({
      where: { tenantId: tid, ...(scope as object), status: "POSTED" as never },
      select: { totalAmount: true, amount: true, taxAmount: true },
    } as never)) as Array<{ totalAmount: unknown; amount: unknown; taxAmount: unknown }>;
    const expenseSum = expenses.reduce((s, e) => s + Number((e.totalAmount as unknown) ?? e.amount ?? 0), 0);
    // Σ JournalLines for EXPENSE source (exclude reversals? include net)
    const entries = await (prisma as never as { journalEntry: { findMany: (a: unknown) => Promise<Array<{ id: string; sourceType: string }>> } }).journalEntry.findMany({
      where: { tenantId: tid, sourceType: "EXPENSE" as never, ...(scope as object) },
      select: { id: true },
    } as never);
    const ids = entries.map((e) => e.id);
    let journalSum = 0;
    if (ids.length) {
      const lines = await (prisma as never as { journalLine: { findMany: (a: unknown) => Promise<Array<{ debit: unknown }>> } }).journalLine.findMany({
        where: { journalEntryId: { in: ids } },
        select: { debit: true },
      } as never);
      journalSum = lines.reduce((s, l) => s + Number(l.debit ?? 0), 0);
      // Check each entry balanced
      for (const je of entries) {
        const jeeLines = await (prisma as never as { journalLine: { findMany: (a: unknown) => Promise<Array<{ debit: unknown; credit: unknown }>> } }).journalLine.findMany({
          where: { journalEntryId: je.id },
          select: { debit: true, credit: true },
        } as never);
        const d = jeeLines.reduce((s, x) => s + Number(x.debit ?? 0), 0);
        const c = jeeLines.reduce((s, x) => s + Number(x.credit ?? 0), 0);
        if (Math.abs(d - c) > 0.0001) {
          return { ok: false, expenseSum, journalSum, message: `Journal ${je.id} unbalanced: debit ${d} vs credit ${c}` };
        }
      }
    }
    const diff = expenseSum - journalSum;
    return {
      ok: Math.abs(diff) < 0.01 && (ids.length === 0 || Math.abs(expenseSum - journalSum) < 0.01),
      expenseSum,
      journalSum,
      diff,
      message: Math.abs(diff) < 0.01 ? "Reconciled" : `Mismatch Σ Expense ${expenseSum} vs Journal ${journalSum} diff ${diff}`,
    };
  },
};
