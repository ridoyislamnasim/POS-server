import { Prisma, type NotificationChannel, type NotificationPriority, type NotificationType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { canAccessBranch } from "../../lib/scope.js";
import { createdAtRange, ilike, parseListQuery, withPagination, acceptEnum } from "../../lib/list-query.js";
import { asJson } from "../../lib/http-errors.js";
import { writeAudit } from "../../lib/audit.js";
import type { RequestContext } from "../../types.js";
import { audienceForType, findTenantUserByAddress, resolveRecipients, type Audience } from "./recipients.js";
import { categoryEnabled, loadNotificationSettings, safeActionUrl } from "./settings.js";

const TYPE_GROUPS: Record<string, NotificationType[]> = {
  stock: ["LOW_STOCK", "OUT_OF_STOCK", "DAMAGE_SUBMITTED", "DAMAGE_APPROVED", "DAMAGE_REJECTED"],
  sales: ["SALE_COMPLETED", "SALE_VOIDED"],
  purchase: ["PURCHASE_CREATED", "PURCHASE_RECEIVED", "PURCHASE_CANCELLED"],
  returns: ["SALE_RETURNED", "RETURN_APPROVAL"],
  staff: ["STAFF_CREATED", "STAFF_DEACTIVATED", "ROLE_CHANGED", "BRANCH_CHANGED", "SHIFT_ALERT"],
  system: ["SYSTEM_ALERT", "BACKUP_SUCCESS", "BACKUP_FAILED", "MANUAL", "PAYMENT_RECEIVED", "DUE_PAYMENT", "EXPENSE_CREATED", "CASH_VARIANCE"],
};

const sendWindow = new Map<string, number[]>();

export function visibleNotificationWhere(ctx: RequestContext): Prisma.NotificationLogWhereInput {
  const tenantId = ctx.tenantId;
  if (!tenantId) return { id: "__none__" };
  const branchFilter: Prisma.NotificationLogWhereInput =
    ctx.allBranches || ctx.isPlatform
      ? {}
      : {
          OR: [{ branchId: null }, { branchId: { in: ctx.branchIds } }],
        };
  return {
    tenantId,
    AND: [
      {
        OR: [
          { recipientUserId: ctx.userId },
          {
            recipientUserId: null,
            recipientRole: { in: ctx.roles.length ? ctx.roles : ["__none__"] },
          },
        ],
      },
      branchFilter,
    ],
  };
}

const listSelect = {
  id: true,
  tenantId: true,
  branchId: true,
  recipientUserId: true,
  recipientRole: true,
  type: true,
  title: true,
  message: true,
  priority: true,
  channel: true,
  status: true,
  isRead: true,
  readAt: true,
  actionUrl: true,
  entityType: true,
  entityId: true,
  template: true,
  to: true,
  createdAt: true,
} as const;

export async function listNotifications(ctx: RequestContext, query: Record<string, unknown>) {
  const list = parseListQuery(query, {
    sortable: ["createdAt", "priority", "type"],
    defaultSort: "createdAt",
    defaultOrder: "desc",
  });
  const tab = typeof query.tab === "string" ? query.tab : "";
  const type = acceptEnum(query.type, [
    "LOW_STOCK",
    "OUT_OF_STOCK",
    "SALE_COMPLETED",
    "SALE_RETURNED",
    "SALE_VOIDED",
    "RETURN_APPROVAL",
    "DAMAGE_SUBMITTED",
    "DAMAGE_APPROVED",
    "DAMAGE_REJECTED",
    "PURCHASE_CREATED",
    "PURCHASE_RECEIVED",
    "PURCHASE_CANCELLED",
    "PAYMENT_RECEIVED",
    "DUE_PAYMENT",
    "EXPENSE_CREATED",
    "CASH_VARIANCE",
    "STAFF_CREATED",
    "STAFF_DEACTIVATED",
    "ROLE_CHANGED",
    "BRANCH_CHANGED",
    "SHIFT_ALERT",
    "SYSTEM_ALERT",
    "BACKUP_SUCCESS",
    "BACKUP_FAILED",
    "MANUAL",
  ] as const);
  const priority = acceptEnum(query.priority, ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const);
  const readFilter = query.isRead === "true" || query.isRead === true ? true : query.isRead === "false" || query.isRead === false ? false : undefined;
  const dates = createdAtRange(list);
  const q = list.search;
  const where: Prisma.NotificationLogWhereInput = {
    AND: [
      visibleNotificationWhere(ctx),
      type ? { type } : {},
      priority ? { priority } : {},
      readFilter !== undefined ? { isRead: readFilter } : {},
      tab === "unread" ? { isRead: false } : {},
      tab === "read" ? { isRead: true } : {},
      tab === "critical" ? { priority: "CRITICAL" } : {},
      TYPE_GROUPS[tab] ? { type: { in: TYPE_GROUPS[tab] } } : {},
      dates ? { createdAt: dates } : {},
      q
        ? {
            OR: [{ title: ilike(q) }, { message: ilike(q) }, { template: ilike(q) }, { to: ilike(q) }],
          }
        : {},
    ],
  };
  return withPagination(list, {
    find: (skip, take) =>
      prisma.notificationLog.findMany({
        where,
        select: listSelect,
        orderBy: { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.notificationLog.count({ where }),
  });
}

export async function unreadCount(ctx: RequestContext) {
  const count = await prisma.notificationLog.count({
    where: { AND: [visibleNotificationWhere(ctx), { isRead: false }] },
  });
  return { count };
}

export async function recentNotifications(ctx: RequestContext, take = 8) {
  return prisma.notificationLog.findMany({
    where: visibleNotificationWhere(ctx),
    select: listSelect,
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function markRead(ctx: RequestContext, id: string) {
  const row = await prisma.notificationLog.findFirst({
    where: { AND: [{ id }, visibleNotificationWhere(ctx)] },
    select: { id: true, isRead: true },
  });
  if (!row) return null;
  if (row.isRead) return prisma.notificationLog.findFirst({ where: { id: row.id }, select: listSelect });
  return prisma.notificationLog.update({
    where: { id: row.id },
    data: { isRead: true, readAt: new Date() },
    select: listSelect,
  });
}

export async function markAllRead(ctx: RequestContext) {
  const result = await prisma.notificationLog.updateMany({
    where: { AND: [visibleNotificationWhere(ctx), { isRead: false }] },
    data: { isRead: true, readAt: new Date() },
  });
  return { updated: result.count };
}

export type DeliverInput = {
  tenantId: string;
  type: NotificationType;
  title: string;
  message: string;
  priority?: NotificationPriority;
  branchId?: string | null;
  actionUrl?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: unknown;
  audience?: Audience;
  extraUserIds?: string[];
  excludeUserIds?: string[];
  explicitUserId?: string | null;
  locationId?: string | null;
  idempotencyBase: string;
  channel?: NotificationChannel;
  to?: string;
};

export async function deliverNotification(input: DeliverInput) {
  const settings = await loadNotificationSettings(input.tenantId);
  if (!categoryEnabled(settings, input.type)) return { created: 0 };
  const recipients = await resolveRecipients({
    tenantId: input.tenantId,
    audience: input.audience ?? audienceForType(input.type),
    branchId: input.branchId,
    locationId: input.locationId,
    extraUserIds: input.extraUserIds,
    excludeUserIds: input.excludeUserIds,
    explicitUserId: input.explicitUserId,
  });
  let created = 0;
  if (settings.inApp) {
    for (const user of recipients) {
      const createdRow = await createInboxRow({
        ...input,
        recipientUserId: user.userId,
        recipientRole: user.primaryRole,
        to: user.userId,
        channel: "IN_APP",
        status: "SENT",
        idempotencyKey: `${input.idempotencyBase}:${user.userId}`,
      });
      if (createdRow) created += 1;
    }
  }
  const external = input.channel && input.channel !== "IN_APP" ? input.channel : null;
  if (external) {
    const enabled =
      (external === "EMAIL" && settings.emailEnabled) ||
      (external === "SMS" && settings.smsEnabled) ||
      (external === "WHATSAPP" && settings.whatsappEnabled);
    if (enabled && input.to) {
      const row = await createInboxRow({
        ...input,
        recipientUserId: recipients[0]?.userId ?? input.explicitUserId ?? null,
        recipientRole: recipients[0]?.primaryRole ?? null,
        to: input.to,
        channel: external,
        status: "QUEUED",
        error: "provider_not_configured",
        idempotencyKey: `${input.idempotencyBase}:${external}:${input.to}`,
      });
      if (row) created += 1;
    }
  }
  return { created };
}

async function createInboxRow(input: DeliverInput & {
  recipientUserId: string | null;
  recipientRole: string | null;
  to: string;
  channel: NotificationChannel;
  status: "SENT" | "QUEUED" | "FAILED";
  error?: string;
  idempotencyKey: string;
}) {
  try {
    return await prisma.notificationLog.create({
      data: {
        tenantId: input.tenantId,
        branchId: input.branchId ?? null,
        recipientUserId: input.recipientUserId,
        recipientRole: input.recipientRole,
        type: input.type,
        title: input.title.slice(0, 200),
        message: input.message.slice(0, 2000),
        priority: input.priority ?? "NORMAL",
        channel: input.channel,
        to: input.to,
        template: input.type,
        status: input.status,
        actionUrl: safeActionUrl(input.actionUrl),
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        payload: asJson(input.payload ?? {}),
        error: input.error,
        idempotencyKey: input.idempotencyKey,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
}

export function checkSendRateLimit(userId: string, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const hits = (sendWindow.get(userId) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return false;
  hits.push(now);
  sendWindow.set(userId, hits);
  return true;
}

export async function sendManual(ctx: RequestContext, body: Record<string, unknown>) {
  const tenantId = ctx.tenantId;
  if (!tenantId) throw Object.assign(new Error("Tenant required"), { code: "FORBIDDEN" });
  if (!checkSendRateLimit(ctx.userId)) {
    throw Object.assign(new Error("Too many notifications. Try again shortly."), { code: "RATE_LIMIT" });
  }
  const channel = acceptEnum(body.channel, ["EMAIL", "SMS", "WHATSAPP", "IN_APP"] as const) ?? "IN_APP";
  const type = acceptEnum(body.type, [
    "MANUAL",
    "SYSTEM_ALERT",
    "LOW_STOCK",
    "SALE_COMPLETED",
  ] as const) ?? "MANUAL";
  const title = String(body.title ?? body.template ?? "Notification").trim();
  const message = String(body.message ?? body.template ?? title).trim();
  if (!title) throw Object.assign(new Error("title required"), { code: "VALIDATION" });
  const to = body.to != null ? String(body.to).trim() : "";
  const userId = body.userId != null ? String(body.userId).trim() : "";
  const found = userId || to ? await findTenantUserByAddress(tenantId, userId || to) : null;
  if (channel === "IN_APP" && !found) {
    throw Object.assign(new Error("Recipient must be a user in this tenant"), { code: "VALIDATION" });
  }
  if ((channel === "EMAIL" || channel === "SMS" || channel === "WHATSAPP") && !to && !found) {
    throw Object.assign(new Error("Recipient address required"), { code: "VALIDATION" });
  }
  if (body.branchId && !canAccessBranch(ctx, String(body.branchId))) {
    throw Object.assign(new Error("Branch not allowed"), { code: "FORBIDDEN" });
  }
  const result = await deliverNotification({
    tenantId,
    type,
    title,
    message,
    priority: acceptEnum(body.priority, ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const) ?? "NORMAL",
    branchId: body.branchId ? String(body.branchId) : null,
    actionUrl: typeof body.actionUrl === "string" ? body.actionUrl : null,
    entityType: typeof body.entityType === "string" ? body.entityType : "Manual",
    payload: body.payload,
    audience: "manual",
    explicitUserId: found?.id ?? null,
    idempotencyBase: `manual:${ctx.userId}:${Date.now()}`,
    channel,
    to: to || found?.email || found?.phone || found?.id,
  });
  await writeAudit({
    ctx,
    action: "notification.send",
    entityType: "NotificationLog",
    after: { type, channel, title, recipientUserId: found?.id ?? null },
  });
  return result;
}

export async function backfillLegacyNotifications() {
  await prisma.$executeRaw`
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
    WHERE title = '' OR ("to" = 'ops' AND "recipientRole" IS NULL)
  `;
}
