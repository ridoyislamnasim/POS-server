-- Notification Center: extend NotificationLog, add StockAlertState, Outbox retry fields.

CREATE TYPE "NotificationType" AS ENUM (
  'LOW_STOCK', 'OUT_OF_STOCK', 'SALE_COMPLETED', 'SALE_RETURNED', 'SALE_VOIDED',
  'RETURN_APPROVAL', 'DAMAGE_SUBMITTED', 'DAMAGE_APPROVED', 'DAMAGE_REJECTED',
  'PURCHASE_CREATED', 'PURCHASE_RECEIVED', 'PURCHASE_CANCELLED', 'PAYMENT_RECEIVED',
  'DUE_PAYMENT', 'EXPENSE_CREATED', 'CASH_VARIANCE', 'STAFF_CREATED', 'STAFF_DEACTIVATED',
  'ROLE_CHANGED', 'BRANCH_CHANGED', 'SHIFT_ALERT', 'SYSTEM_ALERT', 'BACKUP_SUCCESS',
  'BACKUP_FAILED', 'MANUAL'
);

CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
CREATE TYPE "StockAlertLevel" AS ENUM ('OK', 'LOW', 'OUT');

ALTER TABLE "NotificationLog"
  ADD COLUMN IF NOT EXISTS "branchId" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientRole" TEXT,
  ADD COLUMN IF NOT EXISTS "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM_ALERT',
  ADD COLUMN IF NOT EXISTS "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "message" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "isRead" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "actionUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "entityType" TEXT,
  ADD COLUMN IF NOT EXISTS "entityId" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationLog_tenantId_idempotencyKey_key"
  ON "NotificationLog"("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "NotificationLog_tenantId_recipientUserId_isRead_createdAt_idx"
  ON "NotificationLog"("tenantId", "recipientUserId", "isRead", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationLog_tenantId_branchId_createdAt_idx"
  ON "NotificationLog"("tenantId", "branchId", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationLog_tenantId_type_createdAt_idx"
  ON "NotificationLog"("tenantId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "NotificationLog_tenantId_priority_createdAt_idx"
  ON "NotificationLog"("tenantId", "priority", "createdAt");

CREATE TABLE IF NOT EXISTS "StockAlertState" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "channel" "ChannelType" NOT NULL DEFAULT 'STORE',
  "level" "StockAlertLevel" NOT NULL DEFAULT 'OK',
  "lastNotifiedAt" TIMESTAMP(3),
  "generation" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "StockAlertState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StockAlertState_tenantId_locationId_channel_variantId_key"
  ON "StockAlertState"("tenantId", "locationId", "channel", "variantId");

ALTER TABLE "OutboxEvent"
  ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastError" TEXT;

CREATE INDEX IF NOT EXISTS "OutboxEvent_processedAt_createdAt_idx"
  ON "OutboxEvent"("processedAt", "createdAt");

UPDATE "NotificationLog"
SET
  type = CASE "template"
    WHEN 'LOW_STOCK' THEN 'LOW_STOCK'::"NotificationType"
    WHEN 'OUT_OF_STOCK' THEN 'OUT_OF_STOCK'::"NotificationType"
    WHEN 'INVOICE' THEN 'SALE_COMPLETED'::"NotificationType"
    WHEN 'STATEMENT' THEN 'DUE_PAYMENT'::"NotificationType"
    ELSE 'SYSTEM_ALERT'::"NotificationType"
  END,
  title = CASE
    WHEN title = '' AND "template" = 'LOW_STOCK' THEN 'Low stock'
    WHEN title = '' AND "template" = 'INVOICE' THEN 'Invoice sent'
    WHEN title = '' AND "template" = 'STATEMENT' THEN 'Statement'
    WHEN title = '' AND "template" = 'OTP' THEN 'OTP'
    WHEN title = '' THEN "template"
    ELSE title
  END,
  message = CASE WHEN message = '' THEN COALESCE("template", '') ELSE message END,
  "recipientRole" = CASE WHEN "to" = 'ops' THEN 'OUTLET_MANAGER' ELSE "recipientRole" END,
  "isRead" = CASE WHEN "to" = 'ops' THEN true ELSE "isRead" END
WHERE title = '' OR ("to" = 'ops' AND "recipientRole" IS NULL);
