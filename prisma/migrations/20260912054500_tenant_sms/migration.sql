-- Tenant/shop SMS module: settings, templates, logs, usage.

DO $$ BEGIN
  CREATE TYPE "SmsRecipientType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'STAFF');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SmsStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "smsAccessEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "smsAccessDisabledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "smsAccessDisabledReason" TEXT;

CREATE TABLE IF NOT EXISTS "SmsSettings" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'GENERIC_HTTP',
  "senderId" TEXT,
  "apiKeyEnc" TEXT,
  "apiSecretEnc" TEXT,
  "apiBaseUrl" TEXT,
  "extraConfigEnc" TEXT,
  "defaultLanguage" TEXT NOT NULL DEFAULT 'en',
  "autoSendEnabled" BOOLEAN NOT NULL DEFAULT true,
  "platformEnabled" BOOLEAN NOT NULL DEFAULT true,
  "monthlyQuota" INTEGER,
  "creditsRemaining" INTEGER,
  "lastBalance" DECIMAL(19,4),
  "lastBalanceCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SmsSettings_tenantId_key" ON "SmsSettings"("tenantId");

DO $$ BEGIN
  ALTER TABLE "SmsSettings" ADD CONSTRAINT "SmsSettings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SmsTemplate" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "recipientType" "SmsRecipientType" NOT NULL,
  "bodyEn" TEXT NOT NULL,
  "bodyBn" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "customized" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SmsTemplate_tenantId_key_key" ON "SmsTemplate"("tenantId", "key");
CREATE INDEX IF NOT EXISTS "SmsTemplate_tenantId_recipientType_idx" ON "SmsTemplate"("tenantId", "recipientType");

CREATE TABLE IF NOT EXISTS "SmsLog" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "recipientName" TEXT,
  "recipientType" "SmsRecipientType" NOT NULL,
  "message" TEXT NOT NULL,
  "templateKey" TEXT,
  "purpose" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'en',
  "sentByUserId" TEXT,
  "sentAt" TIMESTAMP(3),
  "status" "SmsStatus" NOT NULL DEFAULT 'PENDING',
  "provider" TEXT,
  "providerResponse" TEXT,
  "error" TEXT,
  "referenceType" TEXT,
  "referenceId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "retryable" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SmsLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SmsLog_tenantId_idempotencyKey_key" ON "SmsLog"("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "SmsLog_tenantId_createdAt_idx" ON "SmsLog"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "SmsLog_tenantId_status_idx" ON "SmsLog"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "SmsLog_tenantId_recipientType_idx" ON "SmsLog"("tenantId", "recipientType");
CREATE INDEX IF NOT EXISTS "SmsLog_tenantId_purpose_idx" ON "SmsLog"("tenantId", "purpose");
CREATE INDEX IF NOT EXISTS "SmsLog_tenantId_referenceType_referenceId_idx" ON "SmsLog"("tenantId", "referenceType", "referenceId");

CREATE TABLE IF NOT EXISTS "SmsUsageMonth" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "period" TEXT NOT NULL,
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "pendingCount" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "SmsUsageMonth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SmsUsageMonth_tenantId_period_key" ON "SmsUsageMonth"("tenantId", "period");
