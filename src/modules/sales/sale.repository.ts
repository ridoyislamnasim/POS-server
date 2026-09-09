import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, assertBranch, requireTenantId } from "../../lib/scope.js";
import { cursorWhere, decodeCursor, pageMeta, parseLimit } from "../../lib/cursor.js";
import type { RequestContext } from "../../types.js";

const saleInclude = {
  items: true,
  payments: true,
  documents: true,
  branch: true,
  returns: { include: { items: true, exchangeItems: true } },
} as const;

export const saleRepository = {
  async getById(ctx: RequestContext, id: string) {
    requireTenantId(ctx);
    const sale = await prisma.sale.findFirst({
      where: { id },
      include: saleInclude,
    });
    if (!sale) throw new ForbiddenError();
    if (sale.tenantId !== ctx.tenantId && !ctx.isPlatform) throw new ForbiddenError();
    assertBranch(ctx, sale.branchId);
    return sale;
  },

  async list(ctx: RequestContext, query: { limit?: unknown; cursor?: unknown }) {
    const tenantId = requireTenantId(ctx);
    const limit = parseLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const rows = await prisma.sale.findMany({
      where: {
        tenantId,
        ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
        ...cursorWhere(cursor),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      include: { items: true, payments: true, branch: true, returns: true },
    });
    return { rows, meta: pageMeta(rows, limit) };
  },
};
