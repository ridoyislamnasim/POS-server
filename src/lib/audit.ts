import { prisma } from "./prisma.js";
import type { RequestContext } from "../types.js";

export async function writeAudit(input: {
  ctx?: RequestContext;
  tenantId?: string | null;
  userId?: string;
  actorUserId?: string;
  impersonatedUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId ?? input.ctx?.tenantId,
        userId: input.userId ?? input.ctx?.userId,
        actorUserId: input.actorUserId ?? input.ctx?.userId,
        impersonatedUserId: input.impersonatedUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before as object | undefined,
        after: input.after as object | undefined,
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
        correlationId: input.correlationId,
      },
    });
  } catch (e) {
    const err = e as { code?: string };
    if (err.code !== "P2022") throw e;
    await prisma.auditLog.create({
      data: {
        tenantId: input.tenantId ?? input.ctx?.tenantId,
        userId: input.userId ?? input.ctx?.userId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        before: input.before as object | undefined,
        after: input.after as object | undefined,
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
        correlationId: input.correlationId,
      },
    });
  }
}
