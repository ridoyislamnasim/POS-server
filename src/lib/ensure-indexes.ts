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
}
