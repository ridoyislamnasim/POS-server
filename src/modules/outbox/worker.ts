import type { NotificationPriority, NotificationType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { deliverNotification } from "../notifications/notification.service.js";
import { stockAlertPriority } from "../notifications/crossing.js";
import { branchIdForLocation } from "../notifications/recipients.js";
import { loadNotificationSettings } from "../notifications/settings.js";
import { dispatchSmsFromOutbox } from "../sms/sms.events.js";

type Payload = Record<string, unknown>;

function str(value: unknown) {
  return value == null ? "" : String(value);
}

function num(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

async function handleEvent(event: {
  id: string;
  tenantId: string;
  type: string;
  eventType: string;
  aggregateId: string | null;
  payload: Prisma.JsonValue;
}) {
  const kind = event.eventType || event.type;
  const payload = (event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload
    : {}) as Payload;
  const base = `outbox:${event.id}`;

  switch (kind) {
    case "STOCK_ALERT":
      return handleStockAlert(event.tenantId, payload, base);
    case "SALE_CREATED":
      return handleSaleCreated(event.tenantId, event.aggregateId, payload, base);
    case "SALE_VOIDED":
      return deliverNotification({
        tenantId: event.tenantId,
        type: "SALE_VOIDED",
        title: `Sale voided ${str(payload.invoiceNumber)}`,
        message: `Invoice ${str(payload.invoiceNumber)} was voided.`,
        priority: "HIGH",
        branchId: str(payload.branchId) || null,
        actionUrl: event.aggregateId ? `/sales?q=${encodeURIComponent(str(payload.invoiceNumber))}` : "/sales",
        entityType: "Sale",
        entityId: event.aggregateId,
        payload,
        extraUserIds: payload.cashierUserId ? [str(payload.cashierUserId)] : [],
        idempotencyBase: base,
      });
    case "RETURN_APPROVAL":
      return deliverNotification({
        tenantId: event.tenantId,
        type: "RETURN_APPROVAL",
        title: "Return needs approval",
        message: `A sale return is waiting for approval${payload.invoiceNumber ? ` (${str(payload.invoiceNumber)})` : ""}.`,
        priority: "HIGH",
        branchId: str(payload.branchId) || null,
        actionUrl: "/returns",
        entityType: "SaleReturn",
        entityId: event.aggregateId,
        payload,
        extraUserIds: payload.cashierUserId ? [str(payload.cashierUserId)] : [],
        idempotencyBase: base,
      });
    case "SALE_RETURNED":
      return deliverNotification({
        tenantId: event.tenantId,
        type: payload.rejected ? "SALE_RETURNED" : "SALE_RETURNED",
        title: payload.rejected ? "Return rejected" : "Sale returned",
        message: str(payload.message) || `Return ${payload.rejected ? "rejected" : "posted"} for ${str(payload.invoiceNumber)}.`,
        priority: payload.rejected ? "HIGH" : "NORMAL",
        branchId: str(payload.branchId) || null,
        actionUrl: "/returns",
        entityType: "SaleReturn",
        entityId: event.aggregateId,
        payload,
        extraUserIds: payload.cashierUserId ? [str(payload.cashierUserId)] : [],
        idempotencyBase: base,
      });
    case "DAMAGE_SUBMITTED":
      return notify(event.tenantId, "DAMAGE_SUBMITTED", "Damage submitted", str(payload.message) || "A damage report was submitted.", "NORMAL", payload, base, "/damage");
    case "DAMAGE_DECIDED":
      return notify(
        event.tenantId,
        payload.approved ? "DAMAGE_APPROVED" : "DAMAGE_REJECTED",
        payload.approved ? "Damage approved" : "Damage rejected",
        str(payload.message) || (payload.approved ? "Damage was approved and stock adjusted." : "Damage was rejected."),
        "NORMAL",
        payload,
        base,
        "/damage",
      );
    case "PURCHASE_CREATED":
      return notify(event.tenantId, "PURCHASE_CREATED", "Purchase order created", str(payload.message) || `PO ${str(payload.number)} created.`, "NORMAL", payload, base, "/purchases");
    case "PURCHASE_RECEIVED":
      return notify(event.tenantId, "PURCHASE_RECEIVED", "Purchase received", str(payload.message) || "Goods were received into stock.", "NORMAL", payload, base, "/receiving");
    case "PURCHASE_CANCELLED":
      return notify(event.tenantId, "PURCHASE_CANCELLED", "Purchase cancelled", str(payload.message) || `PO ${str(payload.number)} cancelled.`, "NORMAL", payload, base, "/purchases");
    case "PAYMENT_RECEIVED":
      return notify(event.tenantId, "PAYMENT_RECEIVED", "Payment received", str(payload.message) || `Payment of ${str(payload.amount)} received.`, "NORMAL", payload, base, "/payments");
    case "DUE_PAYMENT":
      return notify(event.tenantId, "DUE_PAYMENT", "Customer due increased", str(payload.message) || `Due recorded for ${str(payload.customerName) || "a customer"}.`, "HIGH", payload, base, "/customers");
    case "EXPENSE_CREATED":
      return notify(event.tenantId, "EXPENSE_CREATED", "Expense created", str(payload.message) || `Expense ${str(payload.amount)} posted.`, "NORMAL", payload, base, "/expenses");
    case "CASH_VARIANCE":
      return notify(event.tenantId, "CASH_VARIANCE", "Cash variance on close", str(payload.message) || `Daily close variance ${str(payload.variance)}.`, "HIGH", payload, base, "/daily-closing");
    case "SHIFT_ALERT":
      return deliverNotification({
        tenantId: event.tenantId,
        type: "SHIFT_ALERT",
        title: "Shift cash variance",
        message: str(payload.message) || `Shift close variance ${str(payload.variance)}.`,
        priority: "HIGH",
        branchId: str(payload.branchId) || null,
        actionUrl: "/shifts",
        entityType: "Shift",
        entityId: event.aggregateId,
        payload,
        extraUserIds: payload.cashierUserId ? [str(payload.cashierUserId)] : [],
        idempotencyBase: base,
      });
    case "STAFF_CREATED":
      return notify(event.tenantId, "STAFF_CREATED", "Staff created", str(payload.message) || `${str(payload.name)} was invited.`, "LOW", payload, base, "/users", payload.targetUserId ? [str(payload.targetUserId)] : []);
    case "STAFF_DEACTIVATED":
      return notify(event.tenantId, "STAFF_DEACTIVATED", "Staff deactivated", str(payload.message) || `${str(payload.name)} was deactivated.`, "HIGH", payload, base, "/users", payload.targetUserId ? [str(payload.targetUserId)] : []);
    case "ROLE_CHANGED":
      return notify(event.tenantId, "ROLE_CHANGED", "Role changed", str(payload.message) || `${str(payload.name)} role was updated.`, "NORMAL", payload, base, "/users", payload.targetUserId ? [str(payload.targetUserId)] : []);
    case "BRANCH_CHANGED":
      return notify(event.tenantId, "BRANCH_CHANGED", "Branch assignment changed", str(payload.message) || `${str(payload.name)} branch access changed.`, "NORMAL", payload, base, "/users", payload.targetUserId ? [str(payload.targetUserId)] : []);
    case "BACKUP_RESULT":
      return notify(
        event.tenantId,
        payload.ok ? "BACKUP_SUCCESS" : "BACKUP_FAILED",
        payload.ok ? "Backup complete" : "Backup failed",
        str(payload.message) || (payload.ok ? "Backup finished successfully." : "Backup failed."),
        payload.ok ? "LOW" : "CRITICAL",
        payload,
        base,
        "/backup",
      );
    case "SYSTEM_ALERT":
      return notify(event.tenantId, "SYSTEM_ALERT", str(payload.title) || "System alert", str(payload.message) || "A system event needs attention.", "HIGH", payload, base, "/notifications");
    case "PLATFORM_INVOICE_SENT":
      return notify(
        event.tenantId,
        "PLATFORM_INVOICE",
        str(payload.title) || `Platform invoice ${str(payload.number)}`,
        str(payload.message) || "A new platform invoice is ready. Open Subscription to view it.",
        "HIGH",
        payload,
        base,
        "/subscription",
      );
    case "PLATFORM_RECEIPT_SENT":
      return notify(
        event.tenantId,
        "PLATFORM_RECEIPT",
        str(payload.title) || `Payment receipt ${str(payload.number)}`,
        str(payload.message) || "Payment confirmed for your platform invoice.",
        "NORMAL",
        payload,
        base,
        "/subscription",
      );
    default:
      return { created: 0 };
  }
}

async function notify(
  tenantId: string,
  type: NotificationType,
  title: string,
  message: string,
  priority: NotificationPriority,
  payload: Payload,
  idempotencyBase: string,
  actionUrl: string,
  extraUserIds?: string[],
) {
  return deliverNotification({
    tenantId,
    type,
    title,
    message,
    priority,
    branchId: str(payload.branchId) || null,
    actionUrl,
    entityType: str(payload.entityType) || type,
    entityId: str(payload.entityId) || null,
    payload,
    extraUserIds,
    idempotencyBase,
  });
}

async function handleStockAlert(tenantId: string, payload: Payload, base: string) {
  const locationId = str(payload.locationId);
  const variantId = str(payload.variantId);
  const available = num(payload.available);
  const threshold = num(payload.threshold) || 5;
  const level = payload.level === "OUT" ? "OUT" : "LOW";
  const [variant, location, branchId] = await Promise.all([
    prisma.productVariant.findFirst({
      where: { id: variantId, tenantId },
      include: { product: { select: { name: true } } },
    }),
    locationId ? prisma.location.findFirst({ where: { id: locationId, tenantId }, select: { name: true } }) : null,
    locationId ? branchIdForLocation(tenantId, locationId) : null,
  ]);
  const name = variant?.product.name ?? "Item";
  const sku = variant?.sku ?? variantId;
  const type: NotificationType = level === "OUT" ? "OUT_OF_STOCK" : "LOW_STOCK";
  const title = level === "OUT" ? `Out of stock: ${name}` : `Low stock: ${name}`;
  const place = location?.name ?? "location";
  return deliverNotification({
    tenantId,
    type,
    title,
    message: `${name} (${sku}) has ${available} available at ${place}. Threshold ${threshold}.`,
    priority: stockAlertPriority(level, available, threshold),
    branchId,
    locationId,
    actionUrl: `/inventory?q=${encodeURIComponent(sku)}`,
    entityType: "ProductVariant",
    entityId: variantId,
    payload: { ...payload, sku, product: name, location: place },
    idempotencyBase: `${base}:${payload.generation ?? 1}`,
  });
}

async function handleSaleCreated(tenantId: string, saleId: string | null, payload: Payload, base: string) {
  const sale = saleId
    ? await prisma.sale.findFirst({
        where: { id: saleId, tenantId },
        select: {
          id: true,
          invoiceNumber: true,
          total: true,
          branchId: true,
          cashierId: true,
          customerId: true,
          due: true,
        },
      })
    : null;
  if (!sale) return { created: 0 };
  const settings = await loadNotificationSettings(tenantId);
  const total = Number(sale.total);
  const high = settings.highValueSaleThreshold != null && total >= settings.highValueSaleThreshold;
  await deliverNotification({
    tenantId,
    type: "SALE_COMPLETED",
    title: high ? `High-value sale ${sale.invoiceNumber}` : `Sale completed ${sale.invoiceNumber}`,
    message: `Invoice ${sale.invoiceNumber} totaling ${total.toFixed(2)}.`,
    priority: high ? "HIGH" : "NORMAL",
    branchId: sale.branchId,
    actionUrl: `/sales?q=${encodeURIComponent(sale.invoiceNumber)}`,
    entityType: "Sale",
    entityId: sale.id,
    payload: { ...payload, total, invoiceNumber: sale.invoiceNumber },
    excludeUserIds: sale.cashierId ? [sale.cashierId] : [],
    idempotencyBase: `${base}:sale`,
  });
  const due = Number(sale.due ?? 0);
  if (due > 0 && sale.customerId) {
    const day = new Date().toISOString().slice(0, 10);
    await deliverNotification({
      tenantId,
      type: "DUE_PAYMENT",
      title: "Customer due recorded",
      message: `Due ${due.toFixed(2)} added from invoice ${sale.invoiceNumber}.`,
      priority: "HIGH",
      branchId: sale.branchId,
      actionUrl: `/customers`,
      entityType: "Customer",
      entityId: sale.customerId,
      payload: { customerId: sale.customerId, due, invoiceNumber: sale.invoiceNumber },
      idempotencyBase: `due:${tenantId}:${sale.customerId}:${day}`,
    });
  }
  return { created: 1 };
}

export async function processOutboxBatch(limit = 20) {
  const events = await prisma.outboxEvent.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const event of events) {
    try {
      await handleEvent(event);
      const kind = event.eventType || event.type;
      const payload = (event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
        ? event.payload
        : {}) as Payload;
      try {
        await dispatchSmsFromOutbox(kind, event.tenantId, event.aggregateId, payload);
      } catch (smsErr) {
        console.warn("SMS dispatch after outbox failed", smsErr);
      }
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date(), lastError: null },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Outbox handler failed";
      const attempts = (event.attempts ?? 0) + 1;
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          attempts,
          lastError: message.slice(0, 500),
          processedAt: attempts >= 5 ? new Date() : null,
        },
      });
      if (attempts >= 5 && event.tenantId) {
        await deliverNotification({
          tenantId: event.tenantId,
          type: "SYSTEM_ALERT",
          title: "Notification worker failed",
          message: `Event ${event.type} failed after retries: ${message.slice(0, 180)}`,
          priority: "HIGH",
          entityType: "OutboxEvent",
          entityId: event.id,
          payload: { type: event.type },
          idempotencyBase: `outbox-fail:${event.id}`,
        }).catch(() => undefined);
      }
    }
  }
  return events.length;
}

export function startOutboxPoller(intervalMs = 5000) {
  const tick = () => {
    processOutboxBatch().catch((e) => console.warn("Outbox poll failed", e));
  };
  tick();
  return setInterval(tick, intervalMs);
}
