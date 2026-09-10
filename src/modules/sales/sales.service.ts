import { Prisma, type PaymentStatus, type SaleStatus } from "@prisma/client";
import { invoiceTotals, lineTotals, toMoneyString } from "../../shared/money.js";
import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, InsufficientStockError, assertBranch, hasPermission, requireTenantId } from "../../lib/scope.js";
import { applyStockChange } from "../inventory/stock.engine.js";
import type { RequestContext } from "../../types.js";

type PayLine = { method: string; amount: string; status?: PaymentStatus };
type ItemIn = {
  variantId: string;
  qty: number;
  discountAmount?: string;
  discountReason?: string;
  associateId?: string;
};

function paymentStatus(p: PayLine): PaymentStatus {
  if (p.status) return p.status;
  return "CAPTURED";
}

function saleStatusFromPayments(payments: { status: PaymentStatus; amount: Prisma.Decimal }[], total: Prisma.Decimal): SaleStatus {
  const captured = payments
    .filter((p) => p.status === "CAPTURED")
    .reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));
  return captured.greaterThanOrEqualTo(total) ? "COMPLETED" : "DRAFT";
}

export async function nextInvoiceNumber(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; branchId: string; fiscalYear: number },
) {
  const rows = await tx.$queryRaw<Array<{ nextNumber: number; prefix: string; padding: number }>>`
    UPDATE "DocumentNumberSequence"
    SET "nextNumber" = "nextNumber" + 1
    WHERE "tenantId" = ${input.tenantId}
      AND "branchId" = ${input.branchId}
      AND "documentType" = 'INVOICE'
      AND "fiscalYear" = ${input.fiscalYear}
    RETURNING "nextNumber", "prefix", "padding"
  `;
  let seq = rows[0];
  if (!seq) {
    const branch = await tx.branch.findFirst({ where: { id: input.branchId, tenantId: input.tenantId } });
    const prefix = `${branch?.code ?? "POS"}-INV-${input.fiscalYear}-`;
    try {
      await tx.documentNumberSequence.create({
        data: {
          tenantId: input.tenantId,
          branchId: input.branchId,
          documentType: "INVOICE",
          fiscalYear: input.fiscalYear,
          prefix,
          padding: 6,
          nextNumber: 2,
        },
      });
    } catch {
      /* unique race — another till created it */
    }
    const retry = await tx.$queryRaw<Array<{ nextNumber: number; prefix: string; padding: number }>>`
      UPDATE "DocumentNumberSequence"
      SET "nextNumber" = "nextNumber" + 1
      WHERE "tenantId" = ${input.tenantId}
        AND "branchId" = ${input.branchId}
        AND "documentType" = 'INVOICE'
        AND "fiscalYear" = ${input.fiscalYear}
      RETURNING "nextNumber", "prefix", "padding"
    `;
    seq = retry[0];
  }
  if (!seq) throw Object.assign(new Error("Invoice sequence missing"), { code: "VALIDATION" });
  let used = seq.nextNumber - 1;
  let invoiceNumber = `${seq.prefix}${String(used).padStart(seq.padding, "0")}`;
  const taken = await tx.sale.findFirst({
    where: { tenantId: input.tenantId, invoiceNumber },
    select: { id: true },
  });
  if (!taken) return invoiceNumber;

  const last = await tx.sale.findFirst({
    where: { tenantId: input.tenantId, branchId: input.branchId, invoiceNumber: { startsWith: seq.prefix } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });
  const parsed = Number(last?.invoiceNumber?.slice(seq.prefix.length) ?? used);
  const nextUsed = (Number.isFinite(parsed) ? parsed : used) + 1;
  await tx.documentNumberSequence.updateMany({
    where: {
      tenantId: input.tenantId,
      branchId: input.branchId,
      documentType: "INVOICE",
      fiscalYear: input.fiscalYear,
    },
    data: { nextNumber: nextUsed + 1 },
  });
  return `${seq.prefix}${String(nextUsed).padStart(seq.padding, "0")}`;
}

export async function createSale(input: {
  ctx: RequestContext;
  correlationId: string;
  branchId: string;
  registerId: string;
  deviceId: string;
  deviceSequence?: number;
  clientTransactionId: string;
  idempotencyKey?: string;
  customerId?: string;
  channel?: "STORE" | "ONLINE" | "MARKETPLACE";
  items: ItemIn[];
  payments: PayLine[];
  transactionDiscount?: string;
}) {
  const tenantId = requireTenantId(input.ctx);
  assertBranch(input.ctx, input.branchId);

  const result = await prisma.$transaction(async (tx) => {
    if (input.idempotencyKey) {
      const existing = await tx.idempotencyRecord.findUnique({
        where: { tenantId_key: { tenantId, key: input.idempotencyKey } },
      });
      if (existing) return { replay: true as const, body: existing.body };
    }

    const dup = await tx.sale.findUnique({
      where: {
        tenantId_clientTransactionId_deviceId: {
          tenantId,
          clientTransactionId: input.clientTransactionId,
          deviceId: input.deviceId,
        },
      },
      include: { items: true, payments: true, documents: true },
    });
    if (dup) return { replay: true as const, body: dup };

    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, tenantId },
      include: { location: true },
    });
    if (!branch) throw Object.assign(new Error("Branch not found"), { code: "NOT_FOUND" });

    const shift = await tx.shift.findFirst({
      where: { cashierId: input.ctx.userId, status: "OPEN", tenantId },
    });
    if (!shift) throw Object.assign(new Error("Open a shift first"), { code: "SHIFT_REQUIRED" });
    if (shift.registerId !== input.registerId) {
      throw Object.assign(new Error("Shift is on another register"), { code: "SHIFT_REQUIRED" });
    }
    if (shift.branchId !== branch.id) {
      throw new ForbiddenError("Shift is on another branch");
    }

    const business = await tx.business.findFirst({ where: { tenantId } });
    const customer = input.customerId
      ? await tx.customer.findFirst({ where: { id: input.customerId, tenantId } })
      : null;
    if (input.customerId && !customer) throw new ForbiddenError();

    const payRows = input.payments.map((p) => ({
      method: p.method,
      amount: new Prisma.Decimal(p.amount),
      status: paymentStatus(p),
    }));
    if (payRows.some((p) => p.amount.lessThanOrEqualTo(0))) {
      throw Object.assign(new Error("Payment amount must be greater than zero"), { code: "VALIDATION" });
    }
    const capturedPaid = payRows
      .filter((p) => p.status === "CAPTURED")
      .reduce((s, p) => s.plus(p.amount), new Prisma.Decimal(0));

    const computed = [];
    for (const item of input.items) {
      const variant = await tx.productVariant.findFirst({
        where: { id: item.variantId, tenantId },
        include: {
          product: { include: { taxCategory: true } },
          attributes: { include: { option: { include: { definition: true } } } },
        },
      });
      if (!variant) throw Object.assign(new Error("Variant not found"), { code: "NOT_FOUND" });

      const rate = variant.product.taxCategory?.rate ?? new Prisma.Decimal(0);
      const line = lineTotals({
        unitPrice: variant.price.toString(),
        qty: item.qty,
        lineDiscount: item.discountAmount ?? 0,
        taxRatePercent: rate.toString(),
      });
      const variantSnap = variant.attributes
        .map((a) => `${a.option.definition.name} ${a.option.label}`)
        .join(" / ");
      computed.push({
        variant,
        qty: new Prisma.Decimal(item.qty),
        line,
        rate,
        variantSnap,
        item,
      });
    }

    const totals = invoiceTotals(
      computed.map((c) => c.line),
      input.transactionDiscount ?? 0,
    );
    if (totals.discount.greaterThan(0)) {
      if (!hasPermission(input.ctx, "discount.apply")) {
        throw new ForbiddenError("Discount permission required");
      }
      const pct = totals.subtotal.greaterThan(0) ? totals.discount.div(totals.subtotal) : new Prisma.Decimal(0);
      if (pct.greaterThan(new Prisma.Decimal("0.10")) && !hasPermission(input.ctx, "discount.approve")) {
        throw Object.assign(new Error("Discount over 10% needs manager approval"), { code: "DISCOUNT_APPROVAL_REQUIRED" });
      }
    }
    const dueAmt = Prisma.Decimal.max(totals.total.minus(capturedPaid), 0);
    const status: SaleStatus =
      capturedPaid.greaterThanOrEqualTo(totals.total)
        ? "COMPLETED"
        : capturedPaid.greaterThan(0)
          ? "COMPLETED"
          : saleStatusFromPayments(payRows, totals.total);

    if (status === "COMPLETED" && dueAmt.greaterThan(0) && !customer) {
      throw Object.assign(new Error("Customer required for credit / due sales"), { code: "VALIDATION" });
    }
    if (status === "COMPLETED" && customer && dueAmt.greaterThan(0)) {
      const limit = new Prisma.Decimal(customer.creditLimit ?? 0);
      const nextDue = new Prisma.Decimal(customer.creditDue ?? 0).plus(dueAmt);
      if (limit.lessThanOrEqualTo(0) || nextDue.greaterThan(limit)) {
        throw Object.assign(new Error("Customer credit limit exceeded"), { code: "CREDIT_LIMIT" });
      }
    }
    const year = new Date(input.ctx.businessDate).getFullYear();
    const saleData = {
        tenantId,
        branchId: branch.id,
        locationId: branch.locationId,
        registerId: input.registerId,
        shiftId: shift.id,
        cashierId: input.ctx.userId,
        channel: input.channel ?? "STORE",
        customerId: customer?.id,
        status,
        businessDate: new Date(input.ctx.businessDate),
        currency: business?.currency ?? "BDT",
        subtotal: toMoneyString(totals.subtotal),
        discount: toMoneyString(totals.discount),
        tax: toMoneyString(totals.tax),
        total: toMoneyString(totals.total),
        paid: toMoneyString(capturedPaid),
        due: toMoneyString(status === "COMPLETED" ? dueAmt : totals.total.minus(capturedPaid)),
        change: toMoneyString(Prisma.Decimal.max(capturedPaid.minus(totals.total), 0)),
        clientTransactionId: input.clientTransactionId,
        deviceId: input.deviceId,
        deviceSequence: input.deviceSequence ?? 1,
        idempotencyKey: input.idempotencyKey,
        businessSnapshot: {
          name: business?.name,
          legalName: business?.legalName,
          vatId: business?.vatId,
          address: business?.address,
          phone: business?.phone,
          email: business?.email,
          logoUrl: business?.logoUrl,
        },
        customerSnapshot: customer
          ? { name: customer.name, phone: customer.phoneCanonical, email: customer.email, address: customer.address, taxId: customer.taxId }
          : Prisma.JsonNull,
        taxRegistrationSnapshot: { vatId: business?.vatId, rateNote: "VAT by line" },
        currencySnapshot: { code: business?.currency ?? "BDT", rate: "1" },
        items: {
          create: computed.map((c) => ({
            variantId: c.variant.id,
            qty: c.qty,
            unitPrice: toMoneyString(c.variant.price),
            originalPrice: toMoneyString(c.variant.price),
            discountAmount: toMoneyString(c.line.discount),
            discountReason: c.item.discountReason,
            taxRate: toMoneyString(c.rate, 4),
            taxAmount: toMoneyString(c.line.tax),
            lineTotal: toMoneyString(c.line.lineTotal),
            productNameSnapshot: c.variant.product.name,
            skuSnapshot: c.variant.sku,
            variantSnapshot: c.variantSnap,
            associateId: c.item.associateId,
          })),
        },
        payments: {
          create: payRows.map((p) => ({
            method: p.method,
            provider: "manual",
            status: p.status,
            amount: p.amount,
          })),
        },
    } as const;

    let sale: Awaited<ReturnType<typeof tx.sale.create>> | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const invoiceNumber = await nextInvoiceNumber(tx, {
        tenantId,
        branchId: branch.id,
        fiscalYear: year,
      });
      try {
        sale = await tx.sale.create({
          data: { ...saleData, invoiceNumber },
          include: { items: true, payments: true },
        });
        break;
      } catch (e) {
        const target = e instanceof Prisma.PrismaClientKnownRequestError ? e.meta?.target : undefined;
        const invoiceClash = Array.isArray(target)
          ? target.includes("invoiceNumber")
          : String(target ?? "").includes("invoiceNumber");
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === "P2002" &&
          invoiceClash &&
          attempt < 11
        ) {
          continue;
        }
        throw e;
      }
    }
    if (!sale) throw Object.assign(new Error("Could not allocate invoice number"), { code: "VALIDATION" });

    if (status === "COMPLETED") {
      for (const c of computed) {
        if (!c.variant.product.trackInventory) continue;
        const blockNegative =
          branch.negativeStockPolicy === "BLOCK" && !c.variant.product.allowNegativeStock;
        await applyStockChange(tx, {
          tenantId,
          locationId: branch.locationId,
          variantId: c.variant.id,
          bucket: "AVAILABLE",
          delta: c.qty.negated(),
          type: "SALE",
          saleId: sale.id,
          referenceType: "Sale",
          referenceId: sale.id,
          createdById: input.ctx.userId,
          allowNegative: !blockNegative,
        });
      }
    }

    const docSnap = { sale, printedAt: new Date().toISOString() };
    await tx.saleDocument.createMany({
      data: [
        { saleId: sale.id, kind: "BILL", version: 1, snapshot: docSnap },
        { saleId: sale.id, kind: "INVOICE", version: 1, snapshot: docSnap },
      ],
    });

    await tx.fiscalDocument.create({
      data: {
        tenantId,
        saleId: sale.id,
        status: "PENDING",
        payload: { saleId: sale.id, invoiceNumber: sale.invoiceNumber, channel: sale.channel },
      },
    });
    await tx.accountingEvent.create({
      data: {
        tenantId,
        saleId: sale.id,
        type: "SALE_REVENUE",
        payload: { saleId: sale.id, total: sale.total, tax: sale.tax, status },
      },
    });

    await tx.outboxEvent.create({
      data: {
        tenantId,
        type: "SALE_CREATED",
        eventType: "SALE_CREATED",
        aggregateId: sale.id,
        payload: { saleId: sale.id, invoiceNumber: sale.invoiceNumber, correlationId: input.correlationId },
        correlationId: input.correlationId,
      },
    });
    if (customer && status === "COMPLETED" && dueAmt.greaterThan(0)) {
      await tx.customer.update({
        where: { id: customer.id },
        data: { creditDue: { increment: dueAmt } },
      });
    }

    if (customer && status === "COMPLETED") {
      const pts = Math.floor(Number(toMoneyString(totals.total, 2)) / 100);
      if (pts > 0) {
        await tx.loyaltyTransaction.create({
          data: {
            tenantId,
            customerId: customer.id,
            type: "EARN",
            points: pts,
            saleId: sale.id,
            notes: sale.invoiceNumber,
          },
        });
        await tx.customer.update({
          where: { id: customer.id },
          data: { loyaltyPoints: { increment: pts } },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        userId: input.ctx.userId,
        actorUserId: input.ctx.userId,
        action: "sale.create",
        entityType: "Sale",
        entityId: sale.id,
        after: { invoiceNumber: sale.invoiceNumber, total: sale.total, status, due: dueAmt },
        correlationId: input.correlationId,
      },
    });
    for (const c of computed) {
      if (c.item.discountAmount && Number(c.item.discountAmount) > 0) {
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: input.ctx.userId,
            actorUserId: input.ctx.userId,
            action: "discount.apply",
            entityType: "SaleItem",
            entityId: sale.id,
            after: { variantId: c.variant.id, amount: c.item.discountAmount, reason: c.item.discountReason },
            correlationId: input.correlationId,
          },
        });
      }
    }

    if (input.idempotencyKey) {
      try {
        await tx.idempotencyRecord.create({
          data: {
            tenantId,
            key: input.idempotencyKey,
            method: "POST",
            path: "/sales",
            status: 201,
            body: sale as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          const existing = await tx.idempotencyRecord.findUnique({
            where: { tenantId_key: { tenantId, key: input.idempotencyKey } },
          });
          if (existing) return { replay: true as const, body: existing.body };
        }
        throw e;
      }
    }

    return { replay: false as const, saleId: sale.id };
  }, { timeout: 20_000, maxWait: 10_000 });

  if (result.replay) return { replay: true as const, body: result.body };

  const full = await prisma.sale.findFirst({
    where: { id: result.saleId, tenantId },
    include: { items: true, payments: true, documents: true, branch: true },
  });
  if (!full) throw Object.assign(new Error("Sale missing after commit"), { code: "VALIDATION" });
  return { replay: false as const, body: full };
}
