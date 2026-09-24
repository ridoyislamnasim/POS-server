import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { financeController } from "./finance.controller.js";
import {
  createDailyClosingSchema,
  createExpenseCategorySchema,
  createExpenseSchema,
  createIncomeSchema,
  createPaymentAccountSchema,
  createPaymentSchema,
  updateAccountingSettingsSchema,
  updateExpenseCategorySchema,
  updateExpenseSchema,
  updateIncomeSchema,
} from "./finance.validation.js";

export const financeRouter = Router();
financeRouter.use(requireAuth, requireTenant);

financeRouter.get("/expense-categories", requirePermission("expense.view"), financeController.listExpenseCategories);
financeRouter.post("/expense-categories", requirePermission("expense.manage"), validateBody(createExpenseCategorySchema), financeController.createExpenseCategory);
financeRouter.patch("/expense-categories/:id", requirePermission("expense.manage"), validateBody(updateExpenseCategorySchema), financeController.updateExpenseCategory);
financeRouter.delete("/expense-categories/:id", requirePermission("expense.manage"), financeController.deleteExpenseCategory);
financeRouter.get("/expenses", requirePermission("expense.view"), financeController.listExpenses);
financeRouter.post("/expenses", requirePermission("expense.manage"), validateBody(createExpenseSchema), financeController.createExpense);
financeRouter.patch("/expenses/:id", requirePermission("expense.manage"), validateBody(updateExpenseSchema), financeController.updateExpense);
financeRouter.delete("/expenses/:id", requirePermission("expense.manage"), financeController.deleteExpense);
financeRouter.post("/expenses/:id/void", requirePermission("expense.manage"), financeController.voidExpense);
financeRouter.get("/payment-accounts", requirePermission("payment.view"), financeController.listPaymentAccounts);
financeRouter.post("/payment-accounts", requirePermission("payment.manage"), validateBody(createPaymentAccountSchema), financeController.createPaymentAccount);
financeRouter.get("/accounting-settings", requirePermission("finance.view"), financeController.getTenantAccountingSettings);
financeRouter.patch("/accounting-settings", requirePermission("finance.view"), validateBody(updateAccountingSettingsSchema), financeController.updateTenantAccountingSettings);
financeRouter.put("/accounting-settings", requirePermission("finance.view"), validateBody(updateAccountingSettingsSchema), financeController.updateTenantAccountingSettings);
financeRouter.get("/reconcile/expenses", requirePermission("finance.view"), financeController.reconcileExpenses);
financeRouter.get("/income", requirePermission("income.view"), financeController.listIncome);
financeRouter.post("/income", requirePermission("income.manage"), validateBody(createIncomeSchema), financeController.createIncome);
financeRouter.patch("/income/:id", requirePermission("income.manage"), validateBody(updateIncomeSchema), financeController.updateIncome);
financeRouter.delete("/income/:id", requirePermission("income.manage"), financeController.deleteIncome);
financeRouter.get("/payments", requirePermission("payment.view"), financeController.listPayments);
financeRouter.post("/payments", requirePermission("payment.manage"), validateBody(createPaymentSchema), financeController.createPayment);
financeRouter.get("/customer-dues", requirePermission("finance.view"), financeController.listCustomerDues);
financeRouter.get("/supplier-dues", requirePermission("finance.view"), financeController.listSupplierDues);
financeRouter.get("/cash-flow", requirePermission("finance.view"), financeController.cashFlow);
financeRouter.get("/profit-loss", requirePermission("report.finance"), financeController.profitLoss);
financeRouter.get("/daily-closing", requirePermission("finance.view"), financeController.listDailyClosings);
financeRouter.post("/daily-closing", requirePermission("shift.close"), validateBody(createDailyClosingSchema), financeController.createDailyClosing);
