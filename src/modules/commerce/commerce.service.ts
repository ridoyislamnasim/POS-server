import { branchScope, nextDocNumber, num, tenantId } from "../../lib/erp.js";
import { acceptEnum, acceptId, createdAtRange, ilike, parseListQuery, withPagination, scopedBranchId } from "../../lib/list-query.js";
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

const STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PACKED", "CANCELLED", "CONVERTED"],
  PACKED: ["SHIPPED", "CANCELLED", "CONVERTED"],
  SHIPPED: ["DELIVERED", "CONVERTED"],
  DELIVERED: ["CONVERTED"],
  CANCELLED: [],
  CONVERTED: [],
};

function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = STATUS_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

/** Commerce business logic. No Express `req`/`res` here. */
export const commerceService = {
  async listSalesOrders(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["createdAt", "number", "total", "status", "expectedDeliveryAt"],
      defaultSort: "createdAt",
      defaultOrder: "desc",
    });
    const status = acceptEnum(query.status, ORDER_STATUSES);
    const customerId = acceptId(query.customerId);
    const branchId = scopedBranchId(ctx, query.branchId);
    const locationId = acceptId(query.locationId);
    const dates = createdAtRange(list);
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      ...branchScope(ctx),
      ...(branchId ? { branchId } : {}),
      ...(locationId ? { locationId } : {}),
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
      ...(dates ? { createdAt: dates } : {}),
      ...(q ? { OR: [{ number: ilike(q) }, { notes: ilike(q) }, { customerNotes: ilike(q) }, { reference: ilike(q) }, { customer: { name: ilike(q) } }, { customer: { phone: ilike(q) } }] } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        commerceRepository.listSalesOrders({
          where,
          skip,
          take,
          orderBy:
            list.sortBy === "number" || list.sortBy === "total" || list.sortBy === "status" || list.sortBy === "expectedDeliveryAt"
              ? { [list.sortBy]: list.sortOrder }
              : { createdAt: list.sortOrder },
        }),
      count: () => commerceRepository.countSalesOrders(where),
    });
  },

  async getSalesOrder(ctx: RequestContext, id: string) {
    const tid = tenantId(ctx);
    const row = await commerceRepository.findSalesOrder(tid, id);
    if (!row) throw new AppError("NOT_FOUND", "Sales order not found", 404);
    assertBranch(ctx, (row as { branchId: string }).branchId);
    // attach stock info for info-only display (no reservation)
    const branch = await prisma.branch.findFirst({ where: { id: (row as { branchId: string }).branchId, tenantId: tid } });
    const locationId = (row as { locationId?: string | null }).locationId ?? branch?.locationId ?? null;
    const items = (row as { items: Array<{ variantId: string }> }).items;
    const stocks = locationId
      ? await prisma.stock.findMany({ where: { tenantId: tid, locationId, variantId: { in: items.map((i) => i.variantId) } } })
      : [];
    const stockMap = new Map(stocks.map((s) => [s.variantId, s]));
    const enriched = {
      ...row,
      items: (row as { items: Record<string, unknown>[] }).items.map((it) => {
        const vId = (it as { variantId: string }).variantId;
        const st = stockMap.get(vId);
        const available = st ? Number(st.quantity) - Number(st.reservedQuantity ?? 0) : null;
        return { ...it, stock: st ? { quantity: String(st.quantity), reservedQuantity: String(st.reservedQuantity ?? 0), available } : null };
      }),
      branchLocationId: locationId,
    };
    return enriched;
  },

  async createSalesOrder(ctx: RequestContext, input: CreateSalesOrderInput) {
    const { branchId, locationId, customerId, notes, customerNotes, internalNotes, deliveryNotes, expectedDeliveryAt, reference, discount, tax, status, items } = input;
    if (!branchId || !Array.isArray(items) || !items.length) {
      throw new AppError("VALIDATION", "branchId and items required", 400);
    }
    assertBranch(ctx, branchId);
    const tid = tenantId(ctx);
    // validate location
    let effLocationId: string | null = null;
    if (locationId) {
      const loc = await prisma.location.findFirst({ where: { id: locationId, tenantId: tid } });
      if (!loc) throw new AppError("NOT_FOUND", "Location not found", 404);
      effLocationId = loc.id;
    } else {
      const br = await prisma.branch.findFirst({ where: { id: branchId, tenantId: tid } });
      effLocationId = br?.locationId ?? null;
    }
    if (customerId) {
      const cust = await prisma.customer.findFirst({ where: { id: customerId, tenantId: tid } });
      if (!cust) throw new AppError("NOT_FOUND", "Customer not found", 404);
    }
    const computed = [];
    let subtotal = 0;
    let discountTotal = 0;
    let taxTotal = 0;
    for (const i of items) {
      const v = await commerceRepository.findVariant(tid, String(i.variantId));
      if (!v) throw new AppError("NOT_FOUND", `Variant ${i.variantId} not found`, 404);
      const qty = num(i.qty);
      if (!Number.isFinite(qty) || qty <= 0) throw new AppError("VALIDATION", "qty must be > 0", 400);
      const price = num((i.unitPrice as number | undefined) ?? (v.price as unknown as number));
      const original = num((i.originalPrice as number | undefined) ?? price);
      const discAmt = num(i.discountAmount ?? 0);
      const discPct = num(i.discountPercent ?? 0);
      const taxRate = num(i.taxRate ?? v.product.taxCategory?.rate ?? 0);
      // discount calc
      const extended = price * qty;
      let lineDisc = discAmt;
      if (discPct > 0) lineDisc += (extended * discPct) / 100;
      lineDisc = Math.min(lineDisc, extended);
      const taxable = Math.max(extended - lineDisc, 0);
      const lineTax = taxable * (taxRate / 100);
      const lineTotal = taxable + lineTax;
      const variantSnap = v.attributes?.map((a: { option: { definition: { name: string }; label: string } }) => `${a.option.definition.name} ${a.option.label}`).join(" / ") ?? "";
      computed.push({
        variantId: v.id,
        qty,
        unitPrice: price,
        originalPrice: original,
        discountAmount: lineDisc,
        taxRate,
        taxAmount: lineTax,
        lineTotal,
        nameSnapshot: v.product.name,
        skuSnapshot: v.sku,
        variantSnapshot: variantSnap,
      });
      subtotal += taxable;
      discountTotal += lineDisc;
      taxTotal += lineTax;
    }
    // order-level discount/tax
    const orderDiscount = num(discount ?? 0);
    const orderTax = num(tax ?? 0);
    // apply order discount to total (simple)
    const totalDiscount = discountTotal + orderDiscount;
    const totalTax = taxTotal + orderTax;
    const total = Math.max(subtotal + totalTax - orderDiscount, 0);
    const number = await nextDocNumber(tid, branchId, "SO", "SO");
    const effStatus = status === "DRAFT" ? "DRAFT" : "CONFIRMED";
    const row = await commerceRepository.createSalesOrder({
      tenantId: tid,
      branchId,
      locationId: effLocationId,
      customerId: customerId || null,
      notes: notes ?? null,
      customerNotes: customerNotes ?? null,
      internalNotes: internalNotes ?? null,
      deliveryNotes: deliveryNotes ?? null,
      expectedDeliveryAt: expectedDeliveryAt ? new Date(expectedDeliveryAt) : null,
      reference: reference ?? null,
      number,
      status: effStatus as never,
      subtotal: String(subtotal),
      discount: String(totalDiscount),
      tax: String(totalTax),
      total: String(total),
      createdById: ctx.userId,
      items: {
        create: computed.map((i) => ({
          variantId: i.variantId,
          qty: String(i.qty),
          unitPrice: String(i.unitPrice),
          originalPrice: String(i.originalPrice),
          discountAmount: String(i.discountAmount),
          taxRate: String(i.taxRate),
          taxAmount: String(i.taxAmount),
          lineTotal: String(i.lineTotal),
          nameSnapshot: i.nameSnapshot,
          skuSnapshot: i.skuSnapshot,
          variantSnapshot: i.variantSnapshot,
        })),
      },
    } as never);
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
    assertBranch(ctx, (existing as { branchId: string }).branchId);
    const currentStatus = (existing as { status: string }).status;
    if (currentStatus === "CONVERTED") throw new AppError("CONFLICT", "Converted orders cannot be edited", 409);
    if (currentStatus === "CANCELLED") throw new AppError("CONFLICT", "Cancelled orders cannot be edited", 409);
    const tid = tenantId(ctx);
    const status = input.status as string | undefined;
    if (status && status !== currentStatus) {
      if (!ORDER_STATUSES.includes(status as never)) throw new AppError("VALIDATION", "Invalid status", 400);
      if (status === "CONVERTED") throw new AppError("VALIDATION", "Use Convert to Sale action", 400);
      if (!canTransition(currentStatus, status)) {
        throw new AppError("VALIDATION", `Cannot transition from ${currentStatus} to ${status}`, 400);
      }
    }
    // items update if provided
    if (Array.isArray((input as { items?: unknown[] }).items) && (input as { items: unknown[] }).items.length) {
      // recompute totals
      const computed: Record<string, string>[] = [];
      let subtotal = 0;
      let discTotal = 0;
      let taxTotal = 0;
      for (const i of (input as CreateSalesOrderInput).items) {
        const v = await commerceRepository.findVariant(tid, String(i.variantId));
        if (!v) throw new AppError("NOT_FOUND", `Variant ${i.variantId} not found`, 404);
        const qty = num(i.qty);
        if (qty <= 0) throw new AppError("VALIDATION", "qty must be > 0", 400);
        const price = num((i.unitPrice as number | undefined) ?? (v.price as unknown as number));
        const original = num((i.originalPrice as number | undefined) ?? price);
        const discAmt = num(i.discountAmount ?? 0);
        const discPct = num(i.discountPercent ?? 0);
        const taxRate = num(i.taxRate ?? v.product.taxCategory?.rate ?? 0);
        const extended = price * qty;
        let lineDisc = discAmt;
        if (discPct > 0) lineDisc += (extended * discPct) / 100;
        lineDisc = Math.min(lineDisc, extended);
        const taxable = Math.max(extended - lineDisc, 0);
        const lineTax = taxable * (taxRate / 100);
        const lineTotal = taxable + lineTax;
        const variantSnap = v.attributes?.map((a: { option: { definition: { name: string }; label: string } }) => `${a.option.definition.name} ${a.option.label}`).join(" / ") ?? "";
        computed.push({
          variantId: v.id,
          qty: String(qty),
          unitPrice: String(price),
          originalPrice: String(original),
          discountAmount: String(lineDisc),
          taxRate: String(taxRate),
          taxAmount: String(lineTax),
          lineTotal: String(lineTotal),
          nameSnapshot: v.product.name,
          skuSnapshot: v.sku,
          variantSnapshot: variantSnap,
        } as never);
        subtotal += taxable;
        discTotal += lineDisc;
        taxTotal += lineTax;
      }
      const total = Math.max(subtotal + taxTotal, 0);
      const updateData: Record<string, unknown> = {
        status: status as never,
        notes: input.notes,
        customerNotes: input.customerNotes,
        internalNotes: input.internalNotes,
        deliveryNotes: input.deliveryNotes,
        expectedDeliveryAt: input.expectedDeliveryAt !== undefined ? (input.expectedDeliveryAt ? new Date(input.expectedDeliveryAt as string) : null) : undefined,
        reference: input.reference,
        locationId: input.locationId,
        subtotal: String(subtotal),
        discount: String(discTotal),
        tax: String(taxTotal),
        total: String(total),
      };
      // clean undefined
      Object.keys(updateData).forEach((k) => updateData[k] === undefined && delete updateData[k]);
      // Need to update items and header in transaction
      const row = await commerceRepository.updateSalesOrderItems(
        existing.id,
        { deleteExisting: true, create: computed as never },
        updateData,
      );
      if (status && status !== currentStatus) {
        await enqueueOutbox(prisma, {
          tenantId: tid,
          type: "ORDER_STATUS",
          aggregateId: row!.id,
          payload: { status: row!.status, entityType: "SalesOrder", entityId: row!.id },
        });
      }
      return row;
    }

    const data: Record<string, unknown> = {
      status: status as never,
      notes: input.notes,
      customerNotes: input.customerNotes,
      internalNotes: input.internalNotes,
      deliveryNotes: input.deliveryNotes,
      expectedDeliveryAt: input.expectedDeliveryAt !== undefined ? (input.expectedDeliveryAt ? new Date(input.expectedDeliveryAt as string) : null) : undefined,
      reference: input.reference,
      locationId: input.locationId,
    };
    Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
    if (input.branchId) {
      assertBranch(ctx, input.branchId);
      data.branchId = input.branchId;
    }
    if (input.customerId !== undefined) {
      if (input.customerId) {
        const cust = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId: tid } });
        if (!cust) throw new AppError("NOT_FOUND", "Customer not found", 404);
        data.customerId = input.customerId;
      } else {
        data.customerId = null;
      }
    }
    const row = await commerceRepository.updateSalesOrder(existing.id, data);
    if (status && status !== existing.status) {
      await enqueueOutbox(prisma, {
        tenantId: tid,
        type: "ORDER_STATUS",
        aggregateId: row.id,
        payload: { status: row.status, entityType: "SalesOrder", entityId: row.id },
      });
    }
    return row;
  },

  async duplicateSalesOrder(ctx: RequestContext, id: string) {
    const tid = tenantId(ctx);
    const existing = await commerceRepository.findSalesOrder(tid, id);
    if (!existing) throw new AppError("NOT_FOUND", "Sales order not found", 404);
    assertBranch(ctx, (existing as { branchId: string }).branchId);
    const number = await nextDocNumber(tid, (existing as { branchId: string }).branchId, "SO", "SO");
    const items = (existing as { items: Array<{ variantId: string; qty: unknown; unitPrice: unknown; originalPrice: unknown; discountAmount: unknown; taxRate: unknown; taxAmount: unknown; lineTotal: unknown; nameSnapshot: string; skuSnapshot: string; variantSnapshot: string | null }> }).items;
    const row = await commerceRepository.createSalesOrder({
      tenantId: tid,
      branchId: (existing as { branchId: string }).branchId,
      locationId: (existing as { locationId?: string | null }).locationId ?? null,
      customerId: (existing as { customerId?: string | null }).customerId ?? null,
      notes: (existing as { notes?: string | null }).notes ?? null,
      customerNotes: (existing as { customerNotes?: string | null }).customerNotes ?? null,
      internalNotes: (existing as { internalNotes?: string | null }).internalNotes ?? null,
      deliveryNotes: (existing as { deliveryNotes?: string | null }).deliveryNotes ?? null,
      expectedDeliveryAt: (existing as { expectedDeliveryAt?: Date | null }).expectedDeliveryAt ?? null,
      reference: null,
      number,
      status: "DRAFT",
      subtotal: String((existing as { subtotal: unknown }).subtotal),
      discount: String((existing as { discount: unknown }).discount ?? 0),
      tax: String((existing as { tax: unknown }).tax ?? 0),
      total: String((existing as { total: unknown }).total),
      createdById: ctx.userId,
      items: {
        create: items.map((it) => ({
          variantId: it.variantId,
          qty: String(it.qty),
          unitPrice: String(it.unitPrice),
          originalPrice: String(it.originalPrice ?? it.unitPrice),
          discountAmount: String(it.discountAmount ?? 0),
          taxRate: String(it.taxRate ?? 0),
          taxAmount: String(it.taxAmount ?? 0),
          lineTotal: String(it.lineTotal),
          nameSnapshot: it.nameSnapshot,
          skuSnapshot: it.skuSnapshot,
          variantSnapshot: it.variantSnapshot,
        })),
      },
    } as never);
    await enqueueOutbox(prisma, {
      tenantId: tid,
      type: "ORDER_STATUS",
      aggregateId: row.id,
      payload: { status: row.status, entityType: "SalesOrder", entityId: row.id },
    });
    return row;
  },

  async convertSalesOrder(ctx: RequestContext, id: string) {
    const tid = tenantId(ctx);
    const order = await commerceRepository.findSalesOrderWithItems(tid, id);
    if (!order) throw new AppError("NOT_FOUND", "Sales order not found", 404);
    assertBranch(ctx, order.branchId);
    if (order.status === "CONVERTED") throw new AppError("CONFLICT", "Already converted", 409);
    if (order.status === "CANCELLED") throw new AppError("CONFLICT", "Cancelled orders cannot be converted", 409);
    if (!order.items.length) throw new AppError("VALIDATION", "Order has no items", 400);
    // Return payload for POS prefill, and mark as CONVERTED? We mark after sale creation via link API.
    // For now, just validate and return convertible payload.
    // The actual conversion to Sale happens via /api/v1/sales with saleId linking.
    // We provide a helper endpoint that links after sale creation.
    return {
      id: order.id,
      number: order.number,
      branchId: order.branchId,
      locationId: (order as { locationId?: string | null }).locationId ?? null,
      customerId: order.customerId,
      items: order.items.map((it) => ({
        variantId: it.variantId,
        qty: String(it.qty),
        unitPrice: String(it.unitPrice),
        discountAmount: String((it as unknown as { discountAmount?: unknown }).discountAmount ?? 0),
        taxRate: String((it as unknown as { taxRate?: unknown }).taxRate ?? 0),
        nameSnapshot: it.nameSnapshot,
        skuSnapshot: it.skuSnapshot,
      })),
      subtotal: String(order.subtotal),
      discount: String((order as unknown as { discount?: unknown }).discount ?? 0),
      tax: String(order.tax),
      total: String(order.total),
      status: order.status,
    };
  },

  async linkConvertedSale(ctx: RequestContext, id: string, saleId: string) {
    const tid = tenantId(ctx);
    const order = await commerceRepository.findSalesOrder(tid, id);
    if (!order) throw new AppError("NOT_FOUND", "Sales order not found", 404);
    assertBranch(ctx, (order as { branchId: string }).branchId);
    if ((order as { status: string }).status === "CONVERTED") throw new AppError("CONFLICT", "Already converted", 409);
    const sale = await prisma.sale.findFirst({ where: { id: saleId, tenantId: tid } });
    if (!sale) throw new AppError("NOT_FOUND", "Sale not found", 404);
    const row = await commerceRepository.updateSalesOrder(order.id, { status: "CONVERTED", saleId } as never);
    await enqueueOutbox(prisma, {
      tenantId: tid,
      type: "ORDER_STATUS",
      aggregateId: row.id,
      payload: { status: "CONVERTED", entityType: "SalesOrder", entityId: row.id, saleId },
    });
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
