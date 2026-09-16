import { prisma } from "../../lib/prisma.js";

/** Data-access for the audit log. No business rules here. */
export const auditRepository = {
  list(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.auditLog.findMany({
      where: opts.where as never,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        userId: true,
        createdAt: true,
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  count(where: Record<string, unknown>) {
    return prisma.auditLog.count({ where: where as never });
  },
};
