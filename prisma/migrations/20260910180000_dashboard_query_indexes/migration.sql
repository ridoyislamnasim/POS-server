-- Dashboard widget queries: tenant + branch + businessDate + status, line/payment joins, stock by location.

CREATE INDEX IF NOT EXISTS "Sale_tenantId_branchId_businessDate_status_idx"
  ON "Sale"("tenantId", "branchId", "businessDate", "status");

CREATE INDEX IF NOT EXISTS "Sale_tenantId_businessDate_status_idx"
  ON "Sale"("tenantId", "businessDate", "status");

CREATE INDEX IF NOT EXISTS "SaleItem_saleId_idx"
  ON "SaleItem"("saleId");

CREATE INDEX IF NOT EXISTS "SaleItem_variantId_idx"
  ON "SaleItem"("variantId");

CREATE INDEX IF NOT EXISTS "PaymentTransaction_saleId_idx"
  ON "PaymentTransaction"("saleId");

CREATE INDEX IF NOT EXISTS "PaymentTransaction_saleId_status_idx"
  ON "PaymentTransaction"("saleId", "status");

CREATE INDEX IF NOT EXISTS "Stock_tenantId_locationId_idx"
  ON "Stock"("tenantId", "locationId");

CREATE INDEX IF NOT EXISTS "Expense_tenantId_status_businessDate_idx"
  ON "Expense"("tenantId", "status", "businessDate");
