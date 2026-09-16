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
    return financeRepository.createExpenseCategory(tenantId(ctx), input.name, input.parentId);
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
    const { categoryId, amount, tax, method, vendor, notes, branchId, businessDate } = input;
    if (!categoryId || amount == null) throw new AppError("VALIDATION", "categoryId and amount required", 400);
    if (branchId) assertBranch(ctx, branchId);
    const row = await financeRepository.createExpense({
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
    });
    await writeAudit({ ctx, action: "expense.create", entityType: "Expense", entityId: row.id, after: row });
    await enqueueOutbox(prisma, {
      tenantId: tenantId(ctx),
      type: "EXPENSE_CREATED",
      aggregateId: row.id,
      payload: { branchId: row.branchId, amount: row.amount, entityType: "Expense", entityId: row.id },
    });
    return row;
  },

  async updateExpense(ctx: RequestContext, id: string, input: UpdateExpenseInput) {
    const existing = await financeRepository.findExpense(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Expense not found", 404);
    if (input.branchId) assertBranch(ctx, input.branchId);
    const row = await financeRepository.updateExpense(existing.id, {
      categoryId: input.categoryId,
      amount: input.amount != null ? String(input.amount) : undefined,
      tax: input.tax != null ? String(input.tax) : undefined,
      method: input.method,
      vendor: input.vendor,
      notes: input.notes,
      branchId: input.branchId === "" ? null : input.branchId,
    });
    await writeAudit({ ctx, action: "expense.update", entityType: "Expense", entityId: row.id });
    return row;
  },

  async deleteExpense(ctx: RequestContext, id: string) {
    const existing = await financeRepository.findExpense(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Expense not found", 404);
    await financeRepository.deleteExpense(existing.id);
    await writeAudit({ ctx, action: "expense.delete", entityType: "Expense", entityId: existing.id, before: existing });
    return { id: existing.id };
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
};
