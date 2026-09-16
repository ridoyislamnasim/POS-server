import { createdAtRange, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import type { RequestContext } from "../../types.js";
import { auditRepository } from "./audit.repository.js";

/** Audit-log queries. Tenant-scoped: callers only ever see their own tenant. */
export const auditService = {
  async list(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "action", "entityType"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
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
    return withPagination(list, {
      find: (skip, take) =>
        auditRepository.list({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "action" || list.sortBy === "entityType"
              ? { [list.sortBy]: list.sortOrder }
              : { createdAt: list.sortOrder },
        }),
      count: () => auditRepository.count(where),
    });
  },
};
