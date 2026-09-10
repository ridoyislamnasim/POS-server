import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, assertTenant, requireTenantId } from "../../lib/scope.js";
import { normalizeBdPhone } from "../../shared/phone.js";
import type { RequestContext } from "../../types.js";
import type { Prisma } from "@prisma/client";
import { parseListQuery, withPagination } from "../../lib/list-query.js";

export const customerRepository = {
  async getById(ctx: RequestContext, id: string) {
    requireTenantId(ctx);
    const row = await prisma.customer.findFirst({ where: { id } });
    if (!row) throw new ForbiddenError();
    assertTenant(ctx, row.tenantId);
    return row;
  },

  async findByPhone(ctx: RequestContext, phone: string) {
    const tenantId = requireTenantId(ctx);
    const phoneCanonical = normalizeBdPhone(phone);
    const digits = phone.replace(/\D/g, "");
    const tail = digits.slice(-11);
    const byKey = await prisma.customer.findUnique({
      where: { tenantId_phoneCanonical: { tenantId, phoneCanonical } },
    });
    if (byKey) return byKey;
    if (!tail) return null;
    return prisma.customer.findFirst({
      where: {
        tenantId,
        OR: [
          { phoneCanonical: { endsWith: tail } },
          { phone: { contains: tail } },
          { phone: { contains: phone.trim() } },
        ],
      },
    });
  },

  searchWhere(tenantId: string, raw?: string): Prisma.CustomerWhereInput {
    const q = raw?.trim();
    if (!q) return { tenantId };
    const digits = q.replace(/\D/g, "");
    const canonical = digits ? normalizeBdPhone(q) : "";
    const or: Prisma.CustomerWhereInput[] = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q } },
      { email: { contains: q, mode: "insensitive" } },
      { id: { startsWith: q } },
    ];
    if (digits.length >= 3) {
      or.push({ phone: { contains: digits } });
      or.push({ phoneCanonical: { contains: digits } });
    }
    if (canonical) or.push({ phoneCanonical: { contains: canonical } });
    return { tenantId, OR: or };
  },

  async list(ctx: RequestContext, query: Record<string, unknown>) {
    const tenantId = requireTenantId(ctx);
    const list = parseListQuery(query, { sortable: ["createdAt", "name", "creditDue", "loyaltyPoints"], defaultSort: "createdAt", defaultOrder: "desc" });
    const minPoints = Number(query.minPoints ?? 0);
    const where: Prisma.CustomerWhereInput = {
      ...this.searchWhere(tenantId, list.search || (typeof query.q === "string" ? query.q : undefined)),
      ...(Number.isFinite(minPoints) && minPoints > 0 ? { loyaltyPoints: { gte: Math.floor(minPoints) } } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        prisma.customer.findMany({
          where,
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            creditLimit: true,
            creditDue: true,
            loyaltyPoints: true,
            status: true,
            createdAt: true,
          },
          orderBy:
            list.sortBy === "name" || list.sortBy === "creditDue" || list.sortBy === "loyaltyPoints"
              ? { [list.sortBy]: list.sortOrder }
              : { createdAt: list.sortOrder },
          skip,
          take,
        }),
      count: () => prisma.customer.count({ where }),
    });
  },

  async search(ctx: RequestContext, query: { q?: string; limit?: unknown }) {
    const tenantId = requireTenantId(ctx);
    const requested = Number(query.limit ?? 20);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.floor(requested), 1), 25) : 20;
    const rows = await prisma.customer.findMany({
      where: this.searchWhere(tenantId, query.q),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        creditDue: true,
        loyaltyPoints: true,
      },
    });
    return rows;
  },

  async upsertByPhone(ctx: RequestContext, input: { name?: string; phone: string }) {
    const tenantId = requireTenantId(ctx);
    const phoneCanonical = normalizeBdPhone(input.phone);
    const displayPhone = input.phone.trim();
    const name = (input.name ?? "").trim() || `Customer ${displayPhone}`;
    return prisma.customer.upsert({
      where: { tenantId_phoneCanonical: { tenantId, phoneCanonical } },
      create: { tenantId, name, phone: displayPhone, phoneCanonical },
      update: { ...(input.name?.trim() ? { name: input.name.trim() } : {}), phone: displayPhone },
    });
  },
};
