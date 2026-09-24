import { z } from "zod";

export const createExpenseCategorySchema = z.object({
  name: z.string().min(1, "name required"),
  parentId: z.string().optional(),
});

export const updateExpenseCategorySchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().nullable().optional(),
});

export const createExpenseSchema = z
  .object({
    categoryId: z.string().min(1, "categoryId and amount required"),
    // legacy: amount+tax, new: subtotal/taxAmount/totalAmount — amount kept for back-compat (maps to total)
    amount: z.union([z.string(), z.number()]).optional(),
    subtotal: z.union([z.string(), z.number()]).optional(),
    tax: z.union([z.string(), z.number()]).optional(),
    taxAmount: z.union([z.string(), z.number()]).optional(),
    totalAmount: z.union([z.string(), z.number()]).optional(),
    taxRecoverable: z.boolean().optional(),
    method: z.string().optional(),
    paymentAccountId: z.string().optional(),
    vendor: z.string().optional(),
    vendorId: z.string().optional(),
    notes: z.string().optional(),
    branchId: z.string().optional(),
    businessDate: z.string().optional(),
  })
  .refine((v) => v.amount != null || v.subtotal != null || v.totalAmount != null, {
    message: "amount or subtotal required",
    path: ["amount"],
  });

export const updateExpenseSchema = z.object({
  categoryId: z.string().optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  subtotal: z.union([z.string(), z.number()]).optional(),
  tax: z.union([z.string(), z.number()]).optional(),
  taxAmount: z.union([z.string(), z.number()]).optional(),
  totalAmount: z.union([z.string(), z.number()]).optional(),
  taxRecoverable: z.boolean().optional(),
  method: z.string().optional(),
  paymentAccountId: z.string().optional(),
  vendor: z.string().optional(),
  vendorId: z.string().optional(),
  notes: z.string().optional(),
  branchId: z.string().optional(),
});

export const createIncomeSchema = z.object({
  category: z.string().min(1, "category and amount required"),
  amount: z.union([z.string(), z.number()]),
  method: z.string().optional(),
  notes: z.string().optional(),
  branchId: z.string().optional(),
  businessDate: z.string().optional(),
});

export const updateIncomeSchema = z.object({
  category: z.string().optional(),
  amount: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  notes: z.string().optional(),
  branchId: z.string().optional(),
});

export const createPaymentSchema = z.object({
  partyType: z.string().min(1, "partyType, partyId, direction, amount required"),
  partyId: z.string().min(1, "partyType, partyId, direction, amount required"),
  direction: z.string().min(1, "partyType, partyId, direction, amount required"),
  amount: z.union([z.string(), z.number()]),
  method: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
  branchId: z.string().optional(),
  saleId: z.string().optional(),
  purchaseId: z.string().optional(),
});

export const createPaymentAccountSchema = z.object({
  name: z.string().min(1, "name required"),
  type: z.enum(["CASH", "BANK", "MFS", "CARD"]),
  branchId: z.string().optional(),
  coaAccountId: z.string().optional(),
});

export const updateAccountingSettingsSchema = z.object({
  defaultTaxRecoverable: z.boolean().optional(),
  useLedgerReports: z.boolean().optional(),
});

export const createDailyClosingSchema = z.object({
  branchId: z.string().min(1, "branchId and countedCash required"),
  countedCash: z.union([z.string(), z.number()]),
  openingCash: z.union([z.string(), z.number()]).optional(),
  notes: z.string().optional(),
});

export type UpdateAccountingSettingsBody = z.infer<typeof updateAccountingSettingsSchema>;
export type CreatePaymentAccountBody = z.infer<typeof createPaymentAccountSchema>;

export type UpdateExpenseCategoryBody = z.infer<typeof updateExpenseCategorySchema>;
export type CreateExpenseCategoryBody = z.infer<typeof createExpenseCategorySchema>;
export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseBody = z.infer<typeof updateExpenseSchema>;
export type CreateIncomeBody = z.infer<typeof createIncomeSchema>;
export type UpdateIncomeBody = z.infer<typeof updateIncomeSchema>;
export type CreatePaymentBody = z.infer<typeof createPaymentSchema>;
export type CreateDailyClosingBody = z.infer<typeof createDailyClosingSchema>;
