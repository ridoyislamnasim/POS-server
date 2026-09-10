import { prisma } from "./prisma.js";

export async function ensurePartialIndexes() {
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Barcode_tenantId_code_active_key"
    ON "Barcode" ("tenantId", "code")
    WHERE active = true
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Stock_tenantId_locationId_variantId_key"
    ON "Stock" ("tenantId", "locationId", "variantId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "Sale_tenantId_idempotencyKey_key"
    ON "Sale" ("tenantId", "idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "SaleReturn_tenantId_idempotencyKey_key"
    ON "SaleReturn" ("tenantId", "idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "StockReceipt_tenantId_idempotencyKey_key"
    ON "StockReceipt" ("tenantId", "idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "StockDamage_tenantId_idempotencyKey_key"
    ON "StockDamage" ("tenantId", "idempotencyKey")
    WHERE "idempotencyKey" IS NOT NULL
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "StockReceipt_tenantId_kind_sourceRef_key"
    ON "StockReceipt" ("tenantId", "kind", "sourceRef")
    WHERE "sourceRef" IS NOT NULL
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Sale_tenantId_branchId_businessDate_status_idx"
    ON "Sale" ("tenantId", "branchId", "businessDate", "status")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Sale_tenantId_businessDate_status_idx"
    ON "Sale" ("tenantId", "businessDate", "status")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "SaleItem_saleId_idx"
    ON "SaleItem" ("saleId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "PaymentTransaction_saleId_idx"
    ON "PaymentTransaction" ("saleId")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "Stock_tenantId_locationId_idx"
    ON "Stock" ("tenantId", "locationId")
  `);
}
