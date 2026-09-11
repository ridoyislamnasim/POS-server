-- Platform owner tenant billing + API access lock.

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PLATFORM_INVOICE';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PLATFORM_RECEIPT';

DO $$ BEGIN
  CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'VOID');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "apiAccessEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "apiAccessDisabledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "apiAccessDisabledReason" TEXT;

CREATE TABLE IF NOT EXISTS "PlatformInvoice" (
  "id" TEXT NOT NULL,
  "number" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "dueDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(19,4) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'BDT',
  "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'PENDING',
  "sentAt" TIMESTAMP(3),
  "paidAt" TIMESTAMP(3),
  "paidNote" TEXT,
  "notes" TEXT,
  "lines" JSONB,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PlatformInvoice_number_key" ON "PlatformInvoice"("number");
CREATE INDEX IF NOT EXISTS "PlatformInvoice_tenantId_status_idx" ON "PlatformInvoice"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "PlatformInvoice_tenantId_dueDate_idx" ON "PlatformInvoice"("tenantId", "dueDate");
CREATE INDEX IF NOT EXISTS "PlatformInvoice_status_dueDate_idx" ON "PlatformInvoice"("status", "dueDate");

DO $$ BEGIN
  ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PlatformInvoiceEvent" (
  "id" TEXT NOT NULL,
  "invoiceId" TEXT,
  "tenantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "note" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformInvoiceEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlatformInvoiceEvent_invoiceId_createdAt_idx"
  ON "PlatformInvoiceEvent"("invoiceId", "createdAt");
CREATE INDEX IF NOT EXISTS "PlatformInvoiceEvent_tenantId_createdAt_idx"
  ON "PlatformInvoiceEvent"("tenantId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "PlatformInvoiceEvent" ADD CONSTRAINT "PlatformInvoiceEvent_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "PlatformInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
