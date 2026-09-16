export type CreateExpenseCategoryInput = {
  name: string;
  parentId?: string;
};

export type CreateExpenseInput = {
  categoryId: string;
  amount: string | number;
  tax?: string | number;
  method?: string;
  vendor?: string;
  notes?: string;
  branchId?: string;
  businessDate?: string;
};

export type UpdateExpenseInput = Partial<CreateExpenseInput>;

export type CreateIncomeInput = {
  category: string;
  amount: string | number;
  method?: string;
  notes?: string;
  branchId?: string;
  businessDate?: string;
};

export type UpdateIncomeInput = Partial<CreateIncomeInput>;

export type CreatePaymentInput = {
  partyType: string;
  partyId: string;
  direction: string;
  amount: string | number;
  method?: string;
  reference?: string;
  notes?: string;
  branchId?: string;
  saleId?: string;
  purchaseId?: string;
};

export type CreateDailyClosingInput = {
  branchId: string;
  countedCash: string | number;
  openingCash?: string | number;
  notes?: string;
};

export type ReportRangeQuery = {
  from?: string;
  to?: string;
};
