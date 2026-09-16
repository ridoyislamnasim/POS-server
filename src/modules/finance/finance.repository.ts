import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { enqueueOutbox } from "../outbox/enqueue.js";

/** Data-access for finance. No business rules here. */
export const financeRepository = {
  // -- expense categories
  listExpenseCategories(tenantId: string) {
    return prisma.expenseCategory.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  },

  createExpenseCategory(tenantId: string, name: string, parentId?: string) {
    return prisma.expenseCategory.create({
      data: { tenantId, name: String(name), parentId: parentId || null },
    });
  },

  // -- expenses
  listExpenses(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.expense.findMany({
      where: opts.where as never,
      include: { category: { select: { id: true, name: true } }, branch: { select: { name: true } } },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countExpenses(where: Record<string, unknown>) {
    return prisma.expense.count({ where: where as never });
  },

  createExpense(data: Parameters<typeof prisma.expense.create>[0]["data"]) {
    return prisma.expense.create({ data, include: { category: true } });
  },

  findExpense(tenantId: string, id: string) {
    return prisma.expense.findFirst({ where: { id, tenantId } });
  },

  updateExpense(id: string, data: Record<string, unknown>) {
    return prisma.expense.update({
      where: { id },
      data: data as never,
      include: { category: true, branch: { select: { name: true } } },
    });
  },

  deleteExpense(id: string) {
    return prisma.expense.delete({ where: { id } });
  },

  // -- income
  listIncome(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.income.findMany({
      where: opts.where as never,
      include: { branch: { select: { name: true } } },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countIncome(where: Record<string, unknown>) {
    return prisma.income.count({ where: where as never });
  },

  createIncome(data: Parameters<typeof prisma.income.create>[0]["data"]) {
    return prisma.income.create({ data });
  },

  findIncome(tenantId: string, id: string) {
    return prisma.income.findFirst({ where: { id, tenantId } });
  },

  updateIncome(id: string, data: Record<string, unknown>) {
    return prisma.income.update({
      where: { id },
      data: data as never,
      include: { branch: { select: { name: true } } },
    });
  },

  deleteIncome(id: string) {
    return prisma.income.delete({ where: { id } });
  },

  // -- ledger payments
  listPayments(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.ledgerPayment.findMany({
      where: opts.where as never,
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
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countPayments(where: Record<string, unknown>) {
    return prisma.ledgerPayment.count({ where: where as never });
  },

  /** Transactional payment creation + application to sale/customer/supplier/purchase. */
  createPaymentApplied(input: {
    tenantId: string;
    branchId: string | null;
    partyType: string;
    partyId: string;
    direction: string;
    amount: Prisma.Decimal;
    method: string;
    reference?: string;
    notes?: string;
    saleId?: string;
    purchaseId?: string;
    businessDate: Date;
    createdById: string;
  }) {
    const { tenantId: tid, amount: amt } = input;
    return prisma.$transaction(async (tx) => {
      if (input.partyType === "CUSTOMER") {
        const customer = await tx.customer.findFirst({ where: { id: input.partyId, tenantId: tid } });
        if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
      }
      if (input.partyType === "SUPPLIER") {
        const supplier = await tx.supplier.findFirst({ where: { id: input.partyId, tenantId: tid } });
        if (!supplier) throw Object.assign(new Error("Supplier not found"), { code: "NOT_FOUND" });
      }
      if (input.saleId) {
        const sale = await tx.sale.findFirst({ where: { id: input.saleId, tenantId: tid } });
        if (!sale) throw Object.assign(new Error("Sale not found"), { code: "NOT_FOUND" });
      }
      if (input.purchaseId) {
        const purchase = await tx.purchase.findFirst({ where: { id: input.purchaseId, tenantId: tid } });
        if (!purchase) throw Object.assign(new Error("Purchase not found"), { code: "NOT_FOUND" });
      }
      const pay = await tx.ledgerPayment.create({
        data: {
          tenantId: tid,
          branchId: input.branchId,
          partyType: input.partyType as never,
          partyId: input.partyId,
          direction: input.direction as never,
          amount: amt,
          method: input.method,
          reference: input.reference,
          notes: input.notes,
          saleId: input.saleId,
          purchaseId: input.purchaseId,
          businessDate: input.businessDate,
          createdById: input.createdById,
        },
      });
      if (input.partyType === "CUSTOMER" && input.direction === "IN") {
        const customer = await tx.customer.findFirst({ where: { id: input.partyId, tenantId: tid } });
        if (!customer) throw Object.assign(new Error("Customer not found"), { code: "NOT_FOUND" });
        if (input.saleId) {
          const sale = await tx.sale.findFirst({ where: { id: input.saleId, tenantId: tid } });
          if (sale) {
            const apply = Prisma.Decimal.min(amt, new Prisma.Decimal(sale.due));
            const paid = new Prisma.Decimal(sale.paid).plus(apply);
            const due = Prisma.Decimal.max(new Prisma.Decimal(sale.due).minus(apply), 0);
            await tx.sale.update({ where: { id: sale.id }, data: { paid, due } });
          }
        }
        const nextDue = Prisma.Decimal.max(new Prisma.Decimal(customer.creditDue).minus(amt), 0);
        await tx.customer.update({ where: { id: customer.id }, data: { creditDue: nextDue } });
      }
      if (input.partyType === "SUPPLIER" && input.direction === "OUT") {
        const supplier = await tx.supplier.findFirst({ where: { id: input.partyId, tenantId: tid } });
        if (!supplier) throw Object.assign(new Error("Supplier not found"), { code: "NOT_FOUND" });
        const nextDue = Prisma.Decimal.max(new Prisma.Decimal(supplier.creditDue).minus(amt), 0);
        await tx.supplier.update({ where: { id: supplier.id }, data: { creditDue: nextDue } });
        if (input.purchaseId) {
          const p = await tx.purchase.findFirst({ where: { id: input.purchaseId, tenantId: tid } });
          if (p) {
            const paid = new Prisma.Decimal(p.paid).plus(amt);
            const due = Prisma.Decimal.max(new Prisma.Decimal(p.total).minus(paid), 0);
            await tx.purchase.update({ where: { id: p.id }, data: { paid, due } });
          }
        }
      }
      if (input.direction === "IN") {
        await enqueueOutbox(tx, {
          tenantId: tid,
          type: "PAYMENT_RECEIVED",
          aggregateId: pay.id,
          payload: {
            branchId: input.branchId,
            amount: String(amt),
            partyType: input.partyType,
            entityType: "LedgerPayment",
            entityId: pay.id,
          },
        });
      }
      if (input.direction === "OUT" && input.partyType === "SUPPLIER") {
        await enqueueOutbox(tx, {
          tenantId: tid,
          type: "PAYMENT_MADE",
          aggregateId: pay.id,
          payload: {
            branchId: input.branchId,
            amount: String(amt),
            partyType: input.partyType,
            entityType: "LedgerPayment",
            entityId: pay.id,
          },
        });
      }
      return pay;
    });
  },

  // -- dues
  listCustomerDues(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.customer.findMany({
      where: opts.where as never,
      select: { id: true, name: true, phone: true, creditDue: true, creditLimit: true },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countCustomerDues(where: Record<string, unknown>) {
    return prisma.customer.count({ where: where as never });
  },

  listSupplierDues(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.supplier.findMany({
      where: opts.where as never,
      select: { id: true, name: true, phone: true, creditDue: true },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countSupplierDues(where: Record<string, unknown>) {
    return prisma.supplier.count({ where: where as never });
  },

  // -- aggregates for cash-flow / profit-loss / daily closing
  salesForRange(tenantId: string, scope: Record<string, unknown>, range: { gte: Date; lte: Date }, statuses: string[]) {
    return prisma.sale.findMany({
      where: { tenantId, ...(scope as object), businessDate: range, status: { in: statuses as never } },
      include: { payments: true, items: true },
    });
  },

  expensesForRange(tenantId: string, scope: Record<string, unknown>, range: { gte: Date; lte: Date }, status?: string) {
    return prisma.expense.findMany({
      where: { tenantId, ...(scope as object), businessDate: range, ...(status ? { status: status as never } : {}) },
      include: { category: true },
    });
  },

  incomeForRange(tenantId: string, scope: Record<string, unknown>, range: { gte: Date; lte: Date }) {
    return prisma.income.findMany({ where: { tenantId, ...(scope as object), businessDate: range } });
  },

  paymentsForRange(tenantId: string, range: { gte: Date; lte: Date }, branchId?: string) {
    return prisma.ledgerPayment.findMany({
      where: { tenantId, ...(branchId ? { branchId } : {}), businessDate: range },
    });
  },

  variantCosts(tenantId: string, variantIds: string[]) {
    return prisma.productVariant.findMany({
      where: { tenantId, id: { in: variantIds } },
      select: { id: true, cost: true },
    });
  },

  // -- daily closing
  listDailyClosings(opts: { where: Record<string, unknown>; skip: number; take: number; order: "asc" | "desc" }) {
    return prisma.dailyClosing.findMany({
      where: opts.where as never,
      include: { branch: { select: { name: true } } },
      orderBy: { businessDate: opts.order },
      skip: opts.skip,
      take: opts.take,
    });
  },

  countDailyClosings(where: Record<string, unknown>) {
    return prisma.dailyClosing.count({ where: where as never });
  },

  upsertDailyClosing(
    key: { tenantId: string; branchId: string; businessDate: Date },
    create: Record<string, unknown>,
    update: Record<string, unknown>,
  ) {
    return prisma.dailyClosing.upsert({
      where: { tenantId_branchId_businessDate: key },
      create: { ...key, ...(create as object) } as never,
      update: update as never,
      include: { branch: true },
    });
  },
};
