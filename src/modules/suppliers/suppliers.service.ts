import { writeAudit } from "../../lib/audit.js";
import { tenantId } from "../../lib/erp.js";
import { acceptEnum, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { suppliersRepository } from "./suppliers.repository.js";
import type { CreateSupplierInput, UpdateSupplierInput } from "./suppliers.types.js";

/** Supplier business logic. No Express `req`/`res` here. */
export const suppliersService = {
  async list(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["name", "createdAt", "creditDue"],
      defaultSort: "name",
      defaultOrder: "asc",
    });
    const status = acceptEnum(query.status, ["ACTIVE", "INACTIVE"] as const);
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [{ name: ilike(q) }, { phone: { contains: q } }, { email: ilike(q) }, { taxId: ilike(q) }],
          }
        : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        suppliersRepository.list({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "creditDue" || list.sortBy === "createdAt"
              ? { [list.sortBy]: list.sortOrder }
              : { name: list.sortOrder },
        }),
      count: () => suppliersRepository.count(where),
    });
  },

  async getById(ctx: RequestContext, id: string) {
    const row = await suppliersRepository.findDetail(tenantId(ctx), id);
    if (!row) throw new AppError("NOT_FOUND", "Supplier not found", 404);
    const payments = await suppliersRepository.listPayments(tenantId(ctx), row.id);
    return { ...row, payments };
  },

  async create(ctx: RequestContext, input: CreateSupplierInput) {
    if (!input.name) throw new AppError("VALIDATION", "name required", 400);
    return suppliersRepository.create(tenantId(ctx), {
      name: input.name,
      phone: input.phone,
      email: input.email,
      address: input.address,
      taxId: input.taxId,
      notes: input.notes,
    });
  },

  async update(ctx: RequestContext, id: string, input: UpdateSupplierInput) {
    const existing = await suppliersRepository.findById(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Supplier not found", 404);
    return suppliersRepository.update(existing.id, { ...input });
  },

  async remove(ctx: RequestContext, id: string) {
    const existing = await suppliersRepository.findById(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Supplier not found", 404);
    if ((await suppliersRepository.countPurchases(existing.id)) > 0) {
      throw new AppError("CONFLICT", "This supplier has purchases and cannot be deleted", 409);
    }
    if ((await suppliersRepository.countPurchaseOrders(existing.id)) > 0) {
      throw new AppError("CONFLICT", "This supplier has purchase orders and cannot be deleted", 409);
    }
    await suppliersRepository.remove(existing.id);
    await writeAudit({
      ctx,
      action: "supplier.delete",
      entityType: "Supplier",
      entityId: existing.id,
      before: { name: existing.name },
    });
    return { id: existing.id };
  },
};
