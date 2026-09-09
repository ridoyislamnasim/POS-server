import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, requireTenantId } from "../../lib/scope.js";
import { cursorWhere, decodeCursor, pageMeta, parseLimit } from "../../lib/cursor.js";
import { normalizeBdPhone } from "../../shared/phone.js";
import type { RequestContext } from "../../types.js";

export const customerRepository = {
  async getById(ctx: RequestContext, id: string) {
    const tenantId = requireTenantId(ctx);
    const row = await prisma.customer.findFirst({ where: { id } });
    if (!row || row.tenantId !== tenantId) throw new ForbiddenError();
    return row;
  },

  async findByPhone(ctx: RequestContext, phone: string) {
    const tenantId = requireTenantId(ctx);
    const phoneCanonical = normalizeBdPhone(phone);
    return prisma.customer.findUnique({
      where: { tenantId_phoneCanonical: { tenantId, phoneCanonical } },
    });
  },

  async list(ctx: RequestContext, query: { limit?: unknown; cursor?: unknown; q?: string }) {
    const tenantId = requireTenantId(ctx);
    const limit = parseLimit(query.limit);
    const cursor = decodeCursor(query.cursor);
    const q = query.q?.trim();
    const rows = await prisma.customer.findMany({
      where: {
        tenantId,
        ...cursorWhere(cursor),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { phone: { contains: q } },
                { phoneCanonical: { contains: normalizeBdPhone(q) } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
    return { rows, meta: pageMeta(rows, limit) };
  },

  async upsertByPhone(ctx: RequestContext, input: { name: string; phone: string }) {
    const tenantId = requireTenantId(ctx);
    const phoneCanonical = normalizeBdPhone(input.phone);
    return prisma.customer.upsert({
      where: { tenantId_phoneCanonical: { tenantId, phoneCanonical } },
      create: { tenantId, name: input.name, phone: input.phone, phoneCanonical },
      update: { name: input.name, phone: input.phone },
    });
  },
};
