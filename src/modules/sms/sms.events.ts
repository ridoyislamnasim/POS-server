import { prisma } from "../../lib/prisma.js";
import { money, sendTransactional, todayLabel } from "./sms.service.js";
import type { SmsTemplateKey } from "./sms.templates.js";

type Payload = Record<string, unknown>;

function str(value: unknown) {
  return value == null ? "" : String(value);
}

async function send(input: Parameters<typeof sendTransactional>[0]) {
  try {
    return await sendTransactional(input);
  } catch (e) {
    console.warn("SMS transactional send failed", e instanceof Error ? e.message : e);
    return { skipped: true, error: "send_failed" };
  }
}

export async function sendSaleConfirmation(tenantId: string, saleId: string) {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, tenantId },
    include: { customer: { select: { id: true, name: true, phone: true, phoneCanonical: true, loyaltyPoints: true } } },
  });
  if (!sale?.customer) return { skipped: true, error: "no_customer" };
  const phone = sale.customer.phoneCanonical || sale.customer.phone;
  const due = Number(sale.due ?? 0);
  const paid = Number(sale.paid ?? 0);
  const baseVars = {
    customerName: sale.customer.name,
    invoiceNo: sale.invoiceNumber,
    amount: money(sale.total),
    dueAmount: money(sale.due),
    paidAmount: money(sale.paid),
    paymentDate: todayLabel(),
    date: todayLabel(),
  };
  const results = [];
  results.push(
    await send({
      tenantId,
      recipientType: "CUSTOMER",
      to: phone,
      recipientName: sale.customer.name,
      templateKey: "SALE_CONFIRMATION",
      vars: baseVars,
      referenceType: "Sale",
      referenceId: sale.id,
      idempotencyKey: `sale-confirm:${sale.id}`,
      automatic: true,
    }),
  );
  if (paid > 0) {
    results.push(
      await send({
        tenantId,
        recipientType: "CUSTOMER",
        to: phone,
        recipientName: sale.customer.name,
        templateKey: "INVOICE_RECEIPT",
        vars: baseVars,
        referenceType: "Sale",
        referenceId: sale.id,
        idempotencyKey: `sale-receipt:${sale.id}`,
        automatic: true,
      }),
    );
  }
  if (due > 0) {
    results.push(
      await send({
        tenantId,
        recipientType: "CUSTOMER",
        to: phone,
        recipientName: sale.customer.name,
        templateKey: "DUE_REMINDER",
        vars: baseVars,
        referenceType: "Sale",
        referenceId: sale.id,
        idempotencyKey: `sale-due:${sale.id}`,
        automatic: true,
      }),
    );
  }
  const earned = Math.floor(Number(sale.total) / 100);
  if (earned > 0) {
    results.push(
      await send({
        tenantId,
        recipientType: "CUSTOMER",
        to: phone,
        recipientName: sale.customer.name,
        templateKey: "LOYALTY_REWARD",
        vars: { ...baseVars, points: earned },
        referenceType: "Sale",
        referenceId: sale.id,
        idempotencyKey: `loyalty:${sale.id}`,
        automatic: true,
      }),
    );
  }
  return results;
}

export async function sendPaymentConfirmation(tenantId: string, paymentId: string) {
  const pay = await prisma.ledgerPayment.findFirst({ where: { id: paymentId, tenantId } });
  if (!pay) return { skipped: true, error: "not_found" };
  if (pay.partyType === "CUSTOMER") {
    const customer = await prisma.customer.findFirst({
      where: { id: pay.partyId, tenantId },
      select: { name: true, phone: true, phoneCanonical: true, creditDue: true },
    });
    if (!customer) return { skipped: true, error: "no_customer" };
    return send({
      tenantId,
      recipientType: "CUSTOMER",
      to: customer.phoneCanonical || customer.phone,
      recipientName: customer.name,
      templateKey: "PAYMENT_CONFIRMATION",
      vars: {
        customerName: customer.name,
        amount: money(pay.amount),
        dueAmount: money(customer.creditDue),
        paymentDate: todayLabel(),
        invoiceNo: pay.reference ?? "",
      },
      referenceType: "LedgerPayment",
      referenceId: pay.id,
      idempotencyKey: `pay-cust:${pay.id}`,
      automatic: true,
    });
  }
  return { skipped: true, error: "not_customer" };
}

export async function sendSupplierPayment(tenantId: string, paymentId: string) {
  const pay = await prisma.ledgerPayment.findFirst({ where: { id: paymentId, tenantId } });
  if (!pay || pay.partyType !== "SUPPLIER") return { skipped: true, error: "not_supplier" };
  const supplier = await prisma.supplier.findFirst({
    where: { id: pay.partyId, tenantId },
    select: { name: true, phone: true, creditDue: true },
  });
  if (!supplier?.phone) return { skipped: true, error: "no_phone" };
  const due = Number(supplier.creditDue);
  const key: SmsTemplateKey = due > 0 ? "SUPPLIER_PARTIAL_PAYMENT" : "SUPPLIER_PAYMENT";
  return send({
    tenantId,
    recipientType: "SUPPLIER",
    to: supplier.phone,
    recipientName: supplier.name,
    templateKey: key,
    vars: {
      supplierName: supplier.name,
      amount: money(pay.amount),
      dueAmount: money(supplier.creditDue),
      paymentDate: todayLabel(),
    },
    referenceType: "LedgerPayment",
    referenceId: pay.id,
    idempotencyKey: `pay-sup:${pay.id}`,
    automatic: true,
  });
}

export async function sendPurchaseConfirmation(tenantId: string, orderId: string) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, tenantId },
    include: { supplier: { select: { name: true, phone: true } } },
  });
  if (!po?.supplier?.phone) return { skipped: true, error: "no_phone" };
  return send({
    tenantId,
    recipientType: "SUPPLIER",
    to: po.supplier.phone,
    recipientName: po.supplier.name,
    templateKey: "PURCHASE_CONFIRMATION",
    vars: { supplierName: po.supplier.name, orderNo: po.number, amount: money(po.total), status: po.status },
    referenceType: "PurchaseOrder",
    referenceId: po.id,
    idempotencyKey: `po-confirm:${po.id}`,
    automatic: true,
  });
}

export async function sendPurchaseReceived(tenantId: string, purchaseId: string) {
  const purchase = await prisma.purchase.findFirst({
    where: { id: purchaseId, tenantId },
    include: { supplier: { select: { name: true, phone: true } } },
  });
  if (!purchase?.supplier?.phone) return { skipped: true, error: "no_phone" };
  return send({
    tenantId,
    recipientType: "SUPPLIER",
    to: purchase.supplier.phone,
    recipientName: purchase.supplier.name,
    templateKey: "PURCHASE_RECEIVED",
    vars: {
      supplierName: purchase.supplier.name,
      invoiceNo: purchase.invoiceNumber,
      amount: money(purchase.total),
      dueAmount: money(purchase.due),
    },
    referenceType: "Purchase",
    referenceId: purchase.id,
    idempotencyKey: `grn-recv:${purchase.id}`,
    automatic: true,
  });
}

export async function sendPurchaseUpdate(tenantId: string, orderId: string, status: string) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id: orderId, tenantId },
    include: { supplier: { select: { name: true, phone: true } } },
  });
  if (!po?.supplier?.phone) return { skipped: true, error: "no_phone" };
  return send({
    tenantId,
    recipientType: "SUPPLIER",
    to: po.supplier.phone,
    recipientName: po.supplier.name,
    templateKey: "PURCHASE_UPDATE",
    vars: { supplierName: po.supplier.name, orderNo: po.number, status, amount: money(po.total) },
    referenceType: "PurchaseOrder",
    referenceId: po.id,
    idempotencyKey: `po-update:${po.id}:${status}`,
    automatic: true,
  });
}

export async function sendPurchaseReturn(tenantId: string, returnId: string) {
  const ret = await prisma.purchaseReturn.findFirst({
    where: { id: returnId, tenantId },
    include: { purchase: { include: { supplier: { select: { name: true, phone: true } } } } },
  });
  if (!ret?.purchase.supplier?.phone) return { skipped: true, error: "no_phone" };
  return send({
    tenantId,
    recipientType: "SUPPLIER",
    to: ret.purchase.supplier.phone,
    recipientName: ret.purchase.supplier.name,
    templateKey: "PURCHASE_RETURN",
    vars: {
      supplierName: ret.purchase.supplier.name,
      invoiceNo: ret.purchase.invoiceNumber,
      orderNo: ret.number,
      refundAmount: money(ret.total),
    },
    referenceType: "PurchaseReturn",
    referenceId: ret.id,
    idempotencyKey: `pur-return:${ret.id}`,
    automatic: true,
  });
}

export async function sendReturnConfirmation(tenantId: string, returnId: string) {
  const ret = await prisma.saleReturn.findFirst({
    where: { id: returnId, tenantId },
    include: {
      sale: { include: { customer: { select: { name: true, phone: true, phoneCanonical: true } } } },
      exchangeItems: { select: { id: true } },
    },
  });
  const customer = ret?.sale.customer;
  if (!customer) return { skipped: true, error: "no_customer" };
  const phone = customer.phoneCanonical || customer.phone;
  const isExchange = (ret.exchangeItems?.length ?? 0) > 0 || ret.kind === "EXCHANGE";
  return send({
    tenantId,
    recipientType: "CUSTOMER",
    to: phone,
    recipientName: customer.name,
    templateKey: isExchange ? "EXCHANGE_NOTIFICATION" : "RETURN_CONFIRMATION",
    vars: {
      customerName: customer.name,
      invoiceNo: ret.sale.invoiceNumber,
      orderNo: ret.number,
      refundAmount: money(ret.refundAmount),
    },
    referenceType: "SaleReturn",
    referenceId: ret.id,
    idempotencyKey: isExchange ? `sale-exch:${ret.id}` : `sale-return:${ret.id}`,
    automatic: true,
  });
}

export async function sendOrderStatus(tenantId: string, orderId: string) {
  const order = await prisma.salesOrder.findFirst({
    where: { id: orderId, tenantId },
    include: { customer: { select: { name: true, phone: true, phoneCanonical: true } } },
  });
  if (!order?.customer) return { skipped: true, error: "no_customer" };
  const phone = order.customer.phoneCanonical || order.customer.phone;
  const ready = order.status === "PACKED";
  const results = [
    await send({
      tenantId,
      recipientType: "CUSTOMER",
      to: phone,
      recipientName: order.customer.name,
      templateKey: "ORDER_STATUS",
      vars: { customerName: order.customer.name, orderNo: order.number, status: order.status, amount: money(order.total) },
      referenceType: "SalesOrder",
      referenceId: order.id,
      idempotencyKey: `order:${order.id}:${order.status}`,
      automatic: true,
    }),
  ];
  if (ready) {
    results.push(
      await send({
        tenantId,
        recipientType: "CUSTOMER",
        to: phone,
        recipientName: order.customer.name,
        templateKey: "ORDER_READY",
        vars: { customerName: order.customer.name, orderNo: order.number, status: order.status },
        referenceType: "SalesOrder",
        referenceId: order.id,
        idempotencyKey: `order-ready:${order.id}:${order.status}`,
        automatic: true,
      }),
    );
  }
  return results;
}

export async function sendDeliveryUpdate(tenantId: string, deliveryId: string) {
  const delivery = await prisma.delivery.findFirst({
    where: { id: deliveryId, tenantId },
    include: {
      salesOrder: { include: { customer: { select: { name: true, phone: true, phoneCanonical: true } } } },
    },
  });
  if (!delivery) return { skipped: true, error: "not_found" };
  const customer = delivery.salesOrder?.customer;
  const phone = delivery.phone || customer?.phoneCanonical || customer?.phone;
  if (!phone) return { skipped: true, error: "no_phone" };
  return send({
    tenantId,
    recipientType: "CUSTOMER",
    to: phone,
    recipientName: customer?.name ?? null,
    templateKey: "DELIVERY_UPDATE",
    vars: {
      customerName: customer?.name,
      orderNo: delivery.salesOrder?.number ?? "",
      status: delivery.status,
      tracking: delivery.tracking ?? "",
    },
    referenceType: "Delivery",
    referenceId: delivery.id,
    idempotencyKey: `delivery:${delivery.id}:${delivery.status}`,
    automatic: true,
  });
}

export async function sendStaffAlert(tenantId: string, userId: string, vars: { status: string; amount?: string; branchName?: string }, key: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, tenants: { some: { tenantId } } },
    select: { name: true, phone: true },
  });
  if (!user?.phone) return { skipped: true, error: "no_phone" };
  return send({
    tenantId,
    recipientType: "STAFF",
    to: user.phone,
    recipientName: user.name,
    templateKey: "STAFF_ALERT",
    vars: { staffName: user.name, status: vars.status, amount: vars.amount, branchName: vars.branchName, date: todayLabel() },
    referenceType: "User",
    referenceId: userId,
    idempotencyKey: `staff:${key}`,
    automatic: true,
  });
}

export async function sendDueReminder(tenantId: string, recipientType: "CUSTOMER" | "SUPPLIER", partyId: string, extra?: { invoiceNo?: string }) {
  if (recipientType === "CUSTOMER") {
    const customer = await prisma.customer.findFirst({
      where: { id: partyId, tenantId },
      select: { id: true, name: true, phone: true, phoneCanonical: true, creditDue: true },
    });
    if (!customer) return { skipped: true, error: "no_customer" };
    return send({
      tenantId,
      recipientType: "CUSTOMER",
      to: customer.phoneCanonical || customer.phone,
      recipientName: customer.name,
      templateKey: "DUE_REMINDER",
      vars: { customerName: customer.name, dueAmount: money(customer.creditDue), invoiceNo: extra?.invoiceNo ?? "", date: todayLabel() },
      referenceType: "Customer",
      referenceId: customer.id,
      idempotencyKey: `due-remind:CUSTOMER:${partyId}:${todayLabel()}`,
      automatic: true,
    });
  }
  const supplier = await prisma.supplier.findFirst({
    where: { id: partyId, tenantId },
    select: { name: true, phone: true, creditDue: true },
  });
  if (!supplier?.phone) return { skipped: true, error: "no_phone" };
  return send({
    tenantId,
    recipientType: "SUPPLIER",
    to: supplier.phone,
    recipientName: supplier.name,
    templateKey: "SUPPLIER_OUTSTANDING",
    vars: { supplierName: supplier.name, dueAmount: money(supplier.creditDue), date: todayLabel() },
    referenceType: "Supplier",
    referenceId: partyId,
    idempotencyKey: `due-remind:SUPPLIER:${partyId}:${todayLabel()}`,
    automatic: true,
  });
}

export async function dispatchSmsFromOutbox(kind: string, tenantId: string, aggregateId: string | null, payload: Payload) {
  const id = aggregateId || str(payload.entityId) || str(payload.saleId);
  try {
    switch (kind) {
      case "SALE_CREATED":
        return id ? sendSaleConfirmation(tenantId, id) : { skipped: true };
      case "SALE_RETURNED":
        if (payload.rejected) return { skipped: true, error: "rejected" };
        return id ? sendReturnConfirmation(tenantId, id) : { skipped: true };
      case "PURCHASE_CREATED":
        return id ? sendPurchaseConfirmation(tenantId, id) : { skipped: true };
      case "PURCHASE_RECEIVED":
        return id ? sendPurchaseReceived(tenantId, id) : { skipped: true };
      case "PURCHASE_CANCELLED":
        return id ? sendPurchaseUpdate(tenantId, id, "CANCELLED") : { skipped: true };
      case "PURCHASE_RETURNED":
        return id ? sendPurchaseReturn(tenantId, id) : { skipped: true };
      case "PAYMENT_RECEIVED":
        return id ? sendPaymentConfirmation(tenantId, id) : { skipped: true };
      case "PAYMENT_MADE":
        return id ? sendSupplierPayment(tenantId, id) : { skipped: true };
      case "ORDER_STATUS":
        return id ? sendOrderStatus(tenantId, id) : { skipped: true };
      case "DELIVERY_UPDATE":
        return id ? sendDeliveryUpdate(tenantId, id) : { skipped: true };
      case "CASH_VARIANCE":
      case "SHIFT_ALERT": {
        const userId = str(payload.cashierUserId);
        if (!userId) return { skipped: true };
        return sendStaffAlert(
          tenantId,
          userId,
          { status: kind === "SHIFT_ALERT" ? "Shift cash variance" : "Daily close variance", amount: str(payload.variance), branchName: str(payload.branchName) },
          `${kind}:${id || str(payload.branchId)}`,
        );
      }
      default:
        return { skipped: true };
    }
  } catch (e) {
    console.warn("SMS outbox dispatch failed", kind, e instanceof Error ? e.message : e);
    return { skipped: true, error: "dispatch_failed" };
  }
}
