import { branchScope, nextDocNumber, num, tenantId } from "../../lib/erp.js";
import { acceptEnum, acceptId, createdAtRange, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { prisma } from "../../lib/prisma.js";
import { assertBranch } from "../../lib/scope.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { commerceRepository } from "./commerce.repository.js";
import type {
  CreateDeliveryInput,
  CreateEcommerceOrderInput,
  CreateSalesOrderInput,
  UpdateDeliveryInput,
  UpdateSalesOrderInput,
} from "./commerce.types.js";

const ORDER_STATUSES = ["DRAFT", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED", "CONVERTED"] as const;

/** Commerce business logic. No Express `req`/`res` here. */
export const commerceService = {
  async listSalesOrders(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "number", "total", "status"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const status = acceptEnum(query.status, ORDER_STATUSES);
    const customerId = acceptId(query.customerId);
    const dates = createdAtRange(list);
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      ...(dates ? { createdAt: dates } : {}),
      ...(q ? { OR: [{ number: ilike(q) }, { notes: ilike(q) }, { customer: { name: ilike(q) } }] } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        commerceRepository.listSalesOrders({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "number" || list.sortBy === "total" || list.sortBy === "status"
              ? { [list.sortBy]: list.sortOrder }
              : { createdAt: list.sortOrder },
        }),
      count: () => commerceRepository.countSalesOrders(where),
    });
  },

  async createSalesOrder(ctx: RequestContext, input: CreateSalesOrderInput) {
    const { branchId, customerId, notes, items } = input;
    if (!branchId || !Array.isArray(items) || !items.length) {
      throw new AppError("VALIDATION", "branchId and items required", 400);
    }
    assertBranch(ctx, branchId);
    const tid = tenantId(ctx);
    const computed = [];
    for (const i of items) {
      const v = await commerceRepository.findVariant(tid, i.variantId);
      if (!v) throw new AppError("NOT_FOUND", "Variant not found", 404);
      const qty = num(i.qty);
      const price = num((i.unitPrice as number | undefined) ?? v.price);
      computed.push({
        variantId: v.id,
        qty,
        unitPrice: price,
        lineTotal: qty * price,
        nameSnapshot: v.product.name,
        skuSnapshot: v.sku,
      });
    }
    const subtotal = computed.reduce((n, i) => n + i.lineTotal, 0);
    const number = await nextDocNumber(tid, branchId, "SO", "SO");
    const row = await commerceRepository.createSalesOrder({
      tenantId: tid,
      branchId,
      customerId: customerId || null,
      notes,
      number,
      status: "CONFIRMED",
      subtotal: String(subtotal),
      tax: "0",
      total: String(subtotal),
      createdById: ctx.userId,
      items: {
        create: computed.map((i) => ({
          ...i,
          qty: String(i.qty),
          unitPrice: String(i.unitPrice),
          lineTotal: String(i.lineTotal),
        })),
      },
    });
    await enqueueOutbox(prisma, {
      tenantId: tid,
      type: "ORDER_STATUS",
      aggregateId: row.id,
      payload: { status: row.status, entityType: "SalesOrder", entityId: row.id },
    });
    return row;
  },

  async updateSalesOrder(ctx: RequestContext, id: string, input: UpdateSalesOrderInput) {
    const existing = await commerceRepository.findSalesOrder(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Sales order not found", 404);
    const status = input.status;
    if (status && !["DRAFT", "CONFIRMED", "PACKED", "SHIPPED", "DELIVERED", "CANCELLED"].includes(status)) {
      throw new AppError("VALIDATION", "Invalid status", 400);
    }
    if (status === "CANCELLED" && existing.status === "CONVERTED") {
      throw new AppError("CONFLICT", "Converted orders cannot be cancelled", 409);
    }
    const row = await commerceRepository.updateSalesOrder(existing.id, {
      status: status as never,
      notes: input.notes,
    });
    if (status && status !== existing.status) {
      await enqueueOutbox(prisma, {
        tenantId: tenantId(ctx),
        type: "ORDER_STATUS",
        aggregateId: row.id,
        payload: { status: row.status, entityType: "SalesOrder", entityId: row.id },
      });
    }
    return row;
  },

  async listEcommerceOrders(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "total", "status"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const status = acceptEnum(query.status, ORDER_STATUSES);
    const q = list.search;
    const dates = createdAtRange(list);
    const where = {
      tenantId: tenantId(ctx),
      ...(status ? { status } : {}),
      ...(dates ? { createdAt: dates } : {}),
      ...(q
        ? {
            OR: [{ channel: ilike(q) }, { externalId: ilike(q) }, { customer: { name: ilike(q) } }],
          }
        : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        commerceRepository.listEcommerceOrders({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "total" || list.sortBy === "status"
              ? { [list.sortBy]: list.sortOrder }
              : { createdAt: list.sortOrder },
        }),
      count: () => commerceRepository.countEcommerceOrders(where),
    });
  },

  async upsertEcommerceOrder(ctx: RequestContext, input: CreateEcommerceOrderInput) {
    const { channel, externalId, customerId, total, payload, status } = input;
    if (!channel || externalId == null || (externalId as unknown) === "" || total == null) {
      throw new AppError("VALIDATION", "channel, externalId, total required", 400);
    }
    return commerceRepository.upsertEcommerceOrder(
      tenantId(ctx),
      channel,
      String(externalId),
      {
        customerId: customerId || null,
        total: String(total),
        payload: payload ?? {},
        status: status ?? "CONFIRMED",
      },
      { payload: payload ?? {}, total: String(total), status: status ?? undefined },
    );
  },

  async deleteEcommerceOrder(ctx: RequestContext, id: string) {
    const existing = await commerceRepository.findEcommerceOrder(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Order not found", 404);
    await commerceRepository.deleteEcommerceOrder(existing.id);
    return { id: existing.id };
  },

  async listDeliveries(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "status"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const status = acceptEnum(query.status, ["PENDING", "ASSIGNED", "IN_TRANSIT", "DELIVERED", "FAILED", "RETURNED"] as const);
    const q = list.search;
    const dates = createdAtRange(list);
    const where = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      ...(status ? { status } : {}),
      ...(dates ? { createdAt: dates } : {}),
      ...(q
        ? { OR: [{ address: ilike(q) }, { phone: { contains: q } }, { tracking: ilike(q) }, { courier: ilike(q) }] }
        : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        commerceRepository.listDeliveries({
          where,
          skip,
          take,
          orderBy: list.sortBy === "status" ? { status: list.sortOrder } : { createdAt: list.sortOrder },
        }),
      count: () => commerceRepository.countDeliveries(where),
    });
  },

  async createDelivery(ctx: RequestContext, input: CreateDeliveryInput) {
    const { branchId, salesOrderId, saleId, address, phone, courier, tracking, scheduledAt, notes } = input;
    if (!branchId || !address) throw new AppError("VALIDATION", "branchId and address required", 400);
    assertBranch(ctx, branchId);
    const row = await commerceRepository.createDelivery({
      tenantId: tenantId(ctx),
      branchId,
      salesOrderId: salesOrderId || null,
      saleId: saleId || null,
      address,
      phone,
      courier,
      tracking,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
      notes,
    });
    await enqueueOutbox(prisma, {
      tenantId: tenantId(ctx),
      type: "DELIVERY_UPDATE",
      aggregateId: row.id,
      payload: { status: row.status, entityType: "Delivery", entityId: row.id },
    });
    return row;
  },

  async updateDelivery(ctx: RequestContext, id: string, input: UpdateDeliveryInput) {
    const existing = await commerceRepository.findDelivery(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Delivery not found", 404);
    const row = await commerceRepository.updateDelivery(existing.id, {
      status: input.status,
      courier: input.courier,
      tracking: input.tracking,
      address: input.address,
      phone: input.phone,
      deliveredAt: input.status === "DELIVERED" ? new Date() : undefined,
      notes: input.notes,
    });
    if (input.status && input.status !== existing.status) {
      await enqueueOutbox(prisma, {
        tenantId: tenantId(ctx),
        type: "DELIVERY_UPDATE",
        aggregateId: row.id,
        payload: { status: row.status, entityType: "Delivery", entityId: row.id },
      });
    }
    return row;
  },

  async deleteDelivery(ctx: RequestContext, id: string) {
    const existing = await commerceRepository.findDelivery(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Delivery not found", 404);
    await commerceRepository.deleteDelivery(existing.id);
    return { id: existing.id };
  },
};
