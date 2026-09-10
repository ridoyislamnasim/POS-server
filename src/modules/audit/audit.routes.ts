import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import type { AuthedRequest } from "../../types.js";
import { createdAtRange, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requireTenant, requirePermission("audit.view"));

auditRouter.get("/", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const list = parseListQuery(req.query, { sortable: ["createdAt", "action", "entityType"], defaultSort: "createdAt", defaultOrder: "desc" });
  const dates = createdAtRange(list);
  const q = list.search;
  const where = {
    tenantId: ctx.tenantId!,
    ...(dates ? { createdAt: dates } : {}),
    ...(q
      ? {
          OR: [{ action: ilike(q) }, { entityType: ilike(q) }, { entityId: { contains: q } }],
        }
      : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          action: true,
          entityType: true,
          entityId: true,
          userId: true,
          createdAt: true,
        },
        orderBy: list.sortBy === "action" || list.sortBy === "entityType" ? { [list.sortBy]: list.sortOrder } : { createdAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.auditLog.count({ where }),
  });
  return okList(res, rows, pagination);
});
