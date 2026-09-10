import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, assertBranch, requireTenantId } from "../../lib/scope.js";
import {
  acceptEnum,
  acceptId,
  createdAtRange,
  ilike,
  parseListQuery,
  scopedBranchId,
  withPagination,
} from "../../lib/list-query.js";
import type { RequestContext } from "../../types.js";

const saleListSelect = {
  id: true,
  invoiceNumber: true,
  total: true,
  paid: true,
  due: true,
  currency: true,
  createdAt: true,
  status: true,
  cashierId: true,
  branch: { select: { id: true, name: true } },
  customer: { select: { id: true, name: true, phone: true } },
} as const;

const saleInclude = {
  items: true,
  payments: true,
  documents: true,
  branch: true,
  customer: { select: { id: true, name: true, phone: true, email: true, address: true, taxId: true } },
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

  async list(ctx: RequestContext, query: Record<string, unknown>) {
    const tenantId = requireTenantId(ctx);
    const list = parseListQuery(query, {
      sortable: ["createdAt", "invoiceNumber", "total", "status"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const status = acceptEnum(query.status, ["DRAFT", "COMPLETED", "VOIDED", "PARTIALLY_RETURNED", "FULLY_RETURNED"] as const);
    const customerId = acceptId(query.customerId);
    const branchId = scopedBranchId(ctx, query.branchId);
    const dates = createdAtRange(list);
    const q = list.search;
    const where = {
      tenantId,
      ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
      ...(branchId ? { branchId } : {}),
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      ...(dates ? { createdAt: dates } : {}),
      ...(q
        ? {
            OR: [
              { invoiceNumber: ilike(q) },
              { customer: { name: ilike(q) } },
              { customer: { phone: { contains: q } } },
            ],
          }
        : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        prisma.sale.findMany({
          where,
          select: saleListSelect,
          orderBy: list.sortBy === "invoiceNumber" || list.sortBy === "total" || list.sortBy === "status"
            ? { [list.sortBy]: list.sortOrder }
            : { createdAt: list.sortOrder },
          skip,
          take,
        }),
      count: () => prisma.sale.count({ where }),
    });
  },
};
