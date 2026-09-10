import path from "node:path";
import { readFile } from "node:fs/promises";
import { prisma } from "../../lib/prisma.js";
import { ForbiddenError, assertBranch, requireTenantId } from "../../lib/scope.js";
import { saleRepository } from "../sales/sale.repository.js";
import { getReturn } from "../sales/returns.service.js";
import type { RequestContext } from "../../types.js";
import type { DocumentLayout, DocumentPayload, DocumentType } from "./document-types.js";
import {
  mapLedgerPaymentDocument,
  mapPurchaseDocument,
  mapReturnDocument,
  mapSaleDocument,
  mapSalePaymentDocument,
} from "./document-mapper.js";
import { asMoney, asText } from "./document-format.js";

const uploadRoot = path.resolve(process.cwd(), "uploads");

async function tenantContext(tenantId: string) {
  const [business, settings] = await Promise.all([
    prisma.business.findFirst({
      where: { tenantId },
      select: { name: true, legalName: true, vatId: true, address: true, phone: true, email: true, logoUrl: true, currency: true },
    }),
    prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { invoiceFooter: true, invoiceTemplate: true, receiptPrinter: true, currency: true, notifications: true },
    }),
  ]);
  return { business, settings };
}

async function userName(id?: string | null) {
  if (!id) return null;
  const row = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return row?.name ?? null;
}

async function variantNames(tenantId: string, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, { name: string; sku: string }>();
  const rows = await prisma.productVariant.findMany({
    where: { tenantId, id: { in: unique } },
    select: { id: true, sku: true, product: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.id, { name: r.product?.name || "Item", sku: r.sku }]));
}

function deny(): never {
  throw new ForbiddenError();
}

export async function loadLogo(url?: string | null): Promise<{ buffer: Buffer | null; dataUri: string | null }> {
  if (!url) return { buffer: null, dataUri: null };
  try {
    if (url.startsWith("data:")) return { buffer: null, dataUri: url };
    let filePath = "";
    if (url.startsWith("/uploads/")) filePath = path.join(uploadRoot, url.replace(/^\/uploads\//, ""));
    else if (url.startsWith("uploads/")) filePath = path.join(uploadRoot, url.slice("uploads/".length));
    if (!filePath) return { buffer: null, dataUri: null };
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(uploadRoot))) return { buffer: null, dataUri: null };
    const buffer = await readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".webp" ? "image/webp" : "application/octet-stream";
    return { buffer, dataUri: `data:${mime};base64,${buffer.toString("base64")}` };
  } catch {
    return { buffer: null, dataUri: null };
  }
}

export async function loadDocument(input: {
  ctx: RequestContext;
  type: DocumentType;
  id: string;
  layout?: DocumentLayout;
}): Promise<DocumentPayload> {
  const tenantId = requireTenantId(input.ctx);
  const { business, settings } = await tenantContext(tenantId);
  const layout = input.layout ?? "invoice";

  if (input.type === "sale") {
    const sale = await saleRepository.getById(input.ctx, input.id);
    const cashierName = await userName(sale.cashierId);
    return mapSaleDocument({ sale, business, settings, cashierName, layout });
  }

  if (input.type === "sale-payment") {
    const pay = await prisma.paymentTransaction.findFirst({
      where: { id: input.id },
      include: { sale: { include: { items: true, payments: true, branch: true, customer: { select: { id: true, name: true, phone: true, email: true, address: true, taxId: true } } } } },
    });
    if (!pay) deny();
    if (pay.sale.tenantId !== tenantId && !input.ctx.isPlatform) deny();
    assertBranch(input.ctx, pay.sale.branchId);
    const cashierName = await userName(pay.sale.cashierId);
    return mapSalePaymentDocument({ sale: pay.sale, payment: pay, business, settings, cashierName, layout });
  }

  if (input.type === "return") {
    const ret = await getReturn(input.ctx, input.id);
    const staffName = await userName(ret.createdById);
    return mapReturnDocument({ ret, business, settings, staffName, layout });
  }

  if (input.type === "payment") {
    const payment = await prisma.ledgerPayment.findFirst({ where: { id: input.id, tenantId } });
    if (!payment) deny();
    if (payment.branchId) assertBranch(input.ctx, payment.branchId);
    let partyName: string | null = null;
    let partyPhone: string | null = null;
    let remainingDue: string | undefined;
    let previousDue: string | undefined;
    let relatedNumber: string | null = null;
    if (payment.partyType === "CUSTOMER") {
      const c = await prisma.customer.findFirst({
        where: { id: payment.partyId, tenantId },
        select: { name: true, phone: true, creditDue: true },
      });
      partyName = c?.name ?? "Customer";
      partyPhone = c?.phone ?? null;
      remainingDue = asMoney(c?.creditDue ?? 0);
      previousDue = asMoney(Number(asText(c?.creditDue ?? 0)) + (payment.direction === "IN" ? Number(asText(payment.amount)) : 0));
    } else if (payment.partyType === "SUPPLIER") {
      const s = await prisma.supplier.findFirst({
        where: { id: payment.partyId, tenantId },
        select: { name: true, phone: true, creditDue: true },
      });
      partyName = s?.name ?? "Supplier";
      partyPhone = s?.phone ?? null;
      remainingDue = asMoney(s?.creditDue ?? 0);
      previousDue = asMoney(Number(asText(s?.creditDue ?? 0)) + (payment.direction === "OUT" ? Number(asText(payment.amount)) : 0));
    }
    if (payment.saleId) {
      const sale = await prisma.sale.findFirst({ where: { id: payment.saleId, tenantId }, select: { invoiceNumber: true, branchId: true } });
      if (sale) {
        assertBranch(input.ctx, sale.branchId);
        relatedNumber = sale.invoiceNumber;
      }
    }
    if (payment.purchaseId) {
      const purchase = await prisma.purchase.findFirst({
        where: { id: payment.purchaseId, tenantId },
        select: { invoiceNumber: true, branchId: true },
      });
      if (purchase) {
        assertBranch(input.ctx, purchase.branchId);
        relatedNumber = purchase.invoiceNumber;
      }
    }
    const staffName = await userName(payment.createdById);
    const branch = payment.branchId
      ? await prisma.branch.findFirst({ where: { id: payment.branchId, tenantId }, select: { name: true } })
      : null;
    return mapLedgerPaymentDocument({
      payment,
      partyName,
      partyPhone,
      remainingDue,
      previousDue,
      relatedNumber,
      business,
      settings,
      staffName,
      branchName: branch?.name,
      layout,
    });
  }

  if (input.type === "purchase") {
    const row = await prisma.purchase.findFirst({
      where: { id: input.id, tenantId },
      include: { supplier: true, branch: { select: { name: true } }, items: true, purchaseOrder: { select: { number: true } } },
    });
    if (!row) deny();
    assertBranch(input.ctx, row.branchId);
    const names = await variantNames(tenantId, row.items.map((i) => i.variantId));
    const staffName = await userName(row.createdById);
    return mapPurchaseDocument({
      type: "purchase",
      id: row.id,
      number: row.invoiceNumber,
      title: "GOODS RECEIVED NOTE",
      status: row.status,
      createdAt: row.createdAt,
      businessDate: row.businessDate,
      notes: row.notes,
      subtotal: row.subtotal,
      tax: row.tax,
      total: row.total,
      paid: row.paid,
      due: row.due,
      relatedNumber: row.purchaseOrder?.number,
      supplier: row.supplier,
      branchName: row.branch?.name,
      staffName,
      items: row.items.map((i) => {
        const v = names.get(i.variantId);
        return {
          name: v?.name ?? "Item (removed)",
          sku: v?.sku,
          qty: i.qty,
          unitCost: i.unitCost,
          taxRate: i.taxRate,
          taxAmount: i.taxAmount,
          lineTotal: i.lineTotal,
        };
      }),
      business,
      settings,
      layout,
    });
  }

  if (input.type === "purchase-order") {
    const row = await prisma.purchaseOrder.findFirst({
      where: { id: input.id, tenantId },
      include: { supplier: true, branch: { select: { name: true } }, items: true },
    });
    if (!row) deny();
    assertBranch(input.ctx, row.branchId);
    const names = await variantNames(tenantId, row.items.map((i) => i.variantId));
    const staffName = await userName(row.createdById);
    return mapPurchaseDocument({
      type: "purchase-order",
      id: row.id,
      number: row.number,
      title: "PURCHASE ORDER",
      status: row.status,
      createdAt: row.createdAt,
      notes: row.notes,
      subtotal: row.subtotal,
      tax: row.tax,
      total: row.total,
      supplier: row.supplier,
      branchName: row.branch?.name,
      staffName,
      items: row.items.map((i) => {
        const v = names.get(i.variantId);
        return {
          name: v?.name ?? "Item (removed)",
          sku: v?.sku,
          qty: i.qty,
          unitCost: i.unitCost,
          taxRate: i.taxRate,
          lineTotal: i.lineTotal,
        };
      }),
      business,
      settings,
      layout,
    });
  }

  if (input.type === "purchase-return") {
    const row = await prisma.purchaseReturn.findFirst({
      where: { id: input.id, tenantId },
      include: { purchase: { select: { invoiceNumber: true } }, branch: { select: { name: true } }, items: true },
    });
    if (!row) deny();
    assertBranch(input.ctx, row.branchId);
    const names = await variantNames(tenantId, row.items.map((i) => i.variantId));
    const staffName = await userName(row.createdById);
    const supplier = await prisma.purchase.findFirst({
      where: { id: row.purchaseId, tenantId },
      include: { supplier: true },
    });
    return mapPurchaseDocument({
      type: "purchase-return",
      id: row.id,
      number: row.number,
      title: "PURCHASE RETURN",
      createdAt: row.createdAt,
      notes: row.notes,
      reason: row.reason,
      total: row.total,
      subtotal: row.total,
      relatedNumber: row.purchase?.invoiceNumber,
      supplier: supplier?.supplier,
      branchName: row.branch?.name,
      staffName,
      items: row.items.map((i) => {
        const v = names.get(i.variantId);
        return {
          name: v?.name ?? "Item (removed)",
          sku: v?.sku,
          qty: i.qty,
          unitCost: i.unitCost,
          lineTotal: i.lineTotal,
        };
      }),
      business,
      settings,
      layout,
    });
  }

  deny();
}

export function permissionFor(type: DocumentType) {
  if (type === "payment") return "payment.view" as const;
  if (type === "purchase" || type === "purchase-order" || type === "purchase-return") return "purchase.view" as const;
  return "sale.view" as const;
}
