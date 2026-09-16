import { writeAudit } from "../../lib/audit.js";
import { tenantId } from "../../lib/erp.js";
import { normalizeBdPhone } from "../../shared/phone.js";
import { AppError } from "../../utils/errors.js";
import type { LoyaltyType } from "@prisma/client";
import type { RequestContext } from "../../types.js";
import { customerRepository } from "./customer.repository.js";
import type { AdjustLoyaltyInput, CreateCustomerInput, UpdateCustomerInput } from "./customers.types.js";

export function canLookupCustomers(ctx: RequestContext) {
  return (
    ctx.isPlatform ||
    ctx.roles.includes("TENANT_OWNER") ||
    ctx.permissions.includes("customer.view") ||
    ctx.permissions.includes("sale.create")
  );
}

export function canWriteCustomers(ctx: RequestContext) {
  return (
    ctx.isPlatform ||
    ctx.permissions.includes("customer.manage") ||
    ctx.permissions.includes("sale.create")
  );
}

/**
 * Customer business logic. No Express `req`/`res` here.
 */
export const customersService = {
  async list(ctx: RequestContext, query: Record<string, unknown>) {
    return customerRepository.list(ctx, query);
  },

  search(ctx: RequestContext, q?: string, limit?: unknown) {
    return customerRepository.search(ctx, { q, limit });
  },

  findByPhone(ctx: RequestContext, phone: string) {
    return customerRepository.findByPhone(ctx, phone);
  },

  async getDetail(ctx: RequestContext, id: string) {
    const row = await customerRepository.getById(ctx, id);
    const [sales, loyalty, payments] = await Promise.all([
      customerRepository.listSales(tenantId(ctx), row.id),
      customerRepository.listLoyalty(tenantId(ctx), row.id),
      customerRepository.listPayments(tenantId(ctx), row.id),
    ]);
    return { ...row, sales, loyalty, payments };
  },

  async create(ctx: RequestContext, input: CreateCustomerInput) {
    const { name, phone, email, address, notes, taxId, creditLimit, type, createOnly } = input;
    if (!phone) throw new AppError("VALIDATION", "phone required", 400);
    if (String(phone).replace(/\D/g, "").length < 10) {
      throw new AppError("VALIDATION", "Enter a valid phone number", 400);
    }
    if (createOnly) {
      const existing = await customerRepository.findByPhone(ctx, String(phone));
      if (existing) return { ...existing, alreadyExists: true as const };
    }
    const row = await customerRepository.upsertByPhone(ctx, { name, phone });
    return customerRepository.updateCustomer(row.id, {
      email,
      address,
      notes,
      taxId,
      type: type || undefined,
      creditLimit: creditLimit != null ? String(creditLimit) : undefined,
    });
  },

  async update(ctx: RequestContext, id: string, input: UpdateCustomerInput) {
    const row = await customerRepository.getById(ctx, id);
    return customerRepository.updateCustomer(row.id, {
      name: input.name,
      email: input.email,
      ...(input.phone ? { phone: input.phone, phoneCanonical: normalizeBdPhone(input.phone) } : {}),
      address: input.address,
      notes: input.notes,
      taxId: input.taxId,
      type: input.type,
      status: input.status,
      creditLimit: input.creditLimit != null ? String(input.creditLimit) : undefined,
      birthday: input.birthday ? new Date(input.birthday) : undefined,
    });
  },

  async remove(ctx: RequestContext, id: string) {
    const row = await customerRepository.getById(ctx, id);
    if ((await customerRepository.countSales(row.id)) > 0) {
      throw new AppError("CONFLICT", "This customer has sales and cannot be deleted", 409);
    }
    if ((await customerRepository.countOrders(row.id)) > 0) {
      throw new AppError("CONFLICT", "This customer has orders and cannot be deleted", 409);
    }
    await customerRepository.deleteLoyalty(row.id);
    await customerRepository.removeCustomer(row.id);
    await writeAudit({
      ctx,
      action: "customer.delete",
      entityType: "Customer",
      entityId: row.id,
      before: { name: row.name },
    });
    return { id: row.id };
  },

  async adjustLoyalty(ctx: RequestContext, id: string, input: AdjustLoyaltyInput) {
    const { type, points, notes } = input;
    if (!type || points == null) throw new AppError("VALIDATION", "type and points required", 400);
    const pts = Number(points);
    const customer = await customerRepository.getById(ctx, id);
    const delta = type === "REDEEM" ? -Math.abs(pts) : type === "ADJUST" ? pts : Math.abs(pts);
    return customerRepository.adjustLoyalty(tenantId(ctx), customer.id, type as LoyaltyType, delta, notes);
  },
};
