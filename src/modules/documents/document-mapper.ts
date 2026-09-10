import type { DocumentLayout, DocumentLine, DocumentParty, DocumentPayload, DocumentType } from "./document-types.js";
import {
  asMoney,
  asQty,
  asText,
  defaultPrintLayout,
  documentFilename,
  formatDate,
  formatDateTime,
  moneyNumber,
  paperWidthMm,
  paymentHeadline,
  returnPolicyText,
  thankYouMessage,
  watermarkFor,
} from "./document-format.js";

type Snapshot = Record<string, unknown>;

function snap(value: unknown): Snapshot {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Snapshot) : {};
}

function partyFrom(source: unknown, fallback?: DocumentParty): DocumentParty | undefined {
  const s = snap(source);
  const name = asText(s.name || s.legalName, fallback?.name ?? "");
  if (!name && !fallback) return undefined;
  return {
    name: name || fallback?.name || "Walk-in",
    phone: asText(s.phone || s.phoneCanonical, fallback?.phone ?? "") || undefined,
    email: asText(s.email, fallback?.email ?? "") || undefined,
    address: asText(s.address, fallback?.address ?? "") || undefined,
    taxId: asText(s.taxId || s.vatId, fallback?.taxId ?? "") || undefined,
  };
}

function issuerFrom(
  snapshot: unknown,
  business: {
    name?: string | null;
    legalName?: string | null;
    vatId?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    logoUrl?: string | null;
  } | null | undefined,
  settings: { invoiceFooter?: string | null; receiptWidthMm?: unknown; invoiceTemplate?: unknown; receiptPrinter?: unknown; notifications?: unknown } | null | undefined,
) {
  const s = snap(snapshot);
  return {
    name: asText(s.name, business?.name ?? "Business"),
    legalName: asText(s.legalName, business?.legalName ?? "") || undefined,
    taxId: asText(s.vatId || s.taxId, business?.vatId ?? "") || undefined,
    address: asText(s.address, business?.address ?? "") || undefined,
    phone: asText(s.phone, business?.phone ?? "") || undefined,
    email: asText(s.email, business?.email ?? "") || undefined,
    logoUrl: asText(s.logoUrl, business?.logoUrl ?? "") || undefined,
    footer: asText(s.footer, settings?.invoiceFooter ?? "") || undefined,
    paperWidthMm: paperWidthMm(settings),
    thankYou: thankYouMessage(settings),
    returnPolicy: returnPolicyText(settings),
    defaultPrintLayout: defaultPrintLayout(settings),
  };
}

function extrasFrom(issuerMeta: ReturnType<typeof issuerFrom>) {
  return {
    paperWidthMm: issuerMeta.paperWidthMm,
    thankYou: issuerMeta.thankYou,
    returnPolicy: issuerMeta.returnPolicy || undefined,
    defaultPrintLayout: issuerMeta.defaultPrintLayout,
    notes: issuerMeta.footer || undefined,
    terms: issuerMeta.footer || undefined,
  };
}

function lineFrom(item: {
  id?: string;
  productNameSnapshot?: string | null;
  skuSnapshot?: string | null;
  variantSnapshot?: string | null;
  name?: string | null;
  sku?: string | null;
  variant?: string | null;
  qty?: unknown;
  unitPrice?: unknown;
  unitCost?: unknown;
  discountAmount?: unknown;
  taxAmount?: unknown;
  taxRate?: unknown;
  lineTotal?: unknown;
  lineRefund?: unknown;
}): DocumentLine {
  const unit = item.unitPrice ?? item.unitCost ?? "0";
  const total = item.lineTotal ?? item.lineRefund ?? "0";
  return {
    name: asText(item.productNameSnapshot || item.name, "Item"),
    sku: asText(item.skuSnapshot || item.sku) || undefined,
    variant: asText(item.variantSnapshot || item.variant) || undefined,
    qty: asQty(item.qty),
    unitPrice: asMoney(unit),
    discount: asMoney(item.discountAmount ?? 0),
    tax: asMoney(item.taxAmount ?? 0),
    taxRate: asText(item.taxRate, "0"),
    lineTotal: asMoney(total),
  };
}

type SaleLike = {
  id: string;
  invoiceNumber: string;
  status?: string | null;
  currency?: string | null;
  createdAt?: Date | string | null;
  businessDate?: Date | string | null;
  subtotal?: unknown;
  discount?: unknown;
  tax?: unknown;
  total?: unknown;
  paid?: unknown;
  due?: unknown;
  change?: unknown;
  businessSnapshot?: unknown;
  customerSnapshot?: unknown;
  items?: Array<Parameters<typeof lineFrom>[0]>;
  payments?: Array<{ method?: string; amount?: unknown; status?: string; providerTransactionId?: string | null; providerReference?: string | null }>;
  branch?: { name?: string | null } | null;
  customer?: { name?: string | null; phone?: string | null; email?: string | null; address?: string | null } | null;
};

export function mapSaleDocument(input: {
  sale: SaleLike;
  business?: Parameters<typeof issuerFrom>[1];
  settings?: Parameters<typeof issuerFrom>[2];
  cashierName?: string | null;
  layout?: DocumentLayout;
}): DocumentPayload {
  const sale = input.sale;
  const issuerMeta = issuerFrom(sale.businessSnapshot, input.business, input.settings);
  const currency = asText(sale.currency, "BDT");
  const layout = input.layout ?? "invoice";
  const party = partyFrom(sale.customerSnapshot, partyFrom(sale.customer) ?? { name: "Walk-in" });
  return {
    type: "sale",
    layout,
    title: layout === "receipt" ? "RECEIPT" : "TAX INVOICE",
    number: sale.invoiceNumber,
    filename: documentFilename(sale.invoiceNumber, "INV", sale.id),
    status: sale.status ?? undefined,
    datetime: formatDateTime(sale.createdAt ?? sale.businessDate),
    businessDate: formatDate(sale.businessDate ?? sale.createdAt),
    currency,
    ...extrasFrom(issuerMeta),
    issuer: issuerMeta,
    party,
    partyLabel: "Bill to",
    branchName: sale.branch?.name ?? undefined,
    staffName: input.cashierName ?? undefined,
    lines: (sale.items ?? []).map(lineFrom),
    subtotal: asMoney(sale.subtotal),
    discount: asMoney(sale.discount),
    tax: asMoney(sale.tax),
    total: asMoney(sale.total),
    paid: asMoney(sale.paid),
    due: asMoney(sale.due),
    change: asMoney(sale.change),
    payments: (sale.payments ?? []).map((p) => ({
      method: asText(p.method, "CASH"),
      amount: asMoney(p.amount),
      status: p.status,
      reference: asText(p.providerReference || p.providerTransactionId) || undefined,
      datetime: formatDateTime(sale.createdAt),
    })),
    watermark: watermarkFor(sale.status),
    paymentHeadline: paymentHeadline(sale.paid, sale.due, currency),
    meta: [
      { label: "Invoice", value: sale.invoiceNumber },
      ...(sale.branch?.name ? [{ label: "Branch", value: sale.branch.name }] : []),
      ...(input.cashierName ? [{ label: "Cashier", value: input.cashierName }] : []),
    ],
    barcodeValue: sale.invoiceNumber,
    operational: false,
  };
}

export function mapSalePaymentDocument(input: {
  sale: SaleLike;
  payment: { id: string; method?: string; amount?: unknown; status?: string; providerTransactionId?: string | null; providerReference?: string | null };
  business?: Parameters<typeof issuerFrom>[1];
  settings?: Parameters<typeof issuerFrom>[2];
  cashierName?: string | null;
  layout?: DocumentLayout;
}): DocumentPayload {
  const layout = input.layout ?? "receipt";
  const base = mapSaleDocument({ ...input, layout });
  const amount = asMoney(input.payment.amount);
  const number = documentFilename(asText(input.payment.providerReference), "PAY", input.payment.id);
  const remaining = asMoney(input.sale.due);
  const previous = asMoney(moneyNumber(input.sale.due) + (asText(input.payment.status).toUpperCase() === "CAPTURED" ? moneyNumber(input.payment.amount) : 0));
  return {
    ...base,
    type: "sale-payment",
    layout,
    title: layout === "invoice" ? "PAYMENT RECEIPT" : "PAYMENT RECEIPT",
    number,
    filename: number,
    relatedNumber: input.sale.invoiceNumber,
    relatedLabel: "Invoice",
    lines: [],
    subtotal: amount,
    discount: asMoney(0),
    tax: asMoney(0),
    total: amount,
    paid: amount,
    due: remaining,
    change: asMoney(input.sale.change),
    payments: [
      {
        method: asText(input.payment.method, "CASH"),
        amount,
        status: input.payment.status,
        reference: asText(input.payment.providerReference || input.payment.providerTransactionId) || undefined,
        datetime: formatDateTime(input.sale.createdAt),
      },
    ],
    paymentHeadline: paymentHeadline(input.sale.paid, input.sale.due, base.currency),
    meta: [
      { label: "Receipt", value: number },
      { label: "Invoice", value: input.sale.invoiceNumber },
      { label: "Payment date", value: formatDateTime(input.sale.createdAt) },
      { label: "Method", value: asText(input.payment.method, "CASH") },
      { label: "Amount paid", value: amount },
      { label: "Previous due", value: previous },
      { label: "Remaining due", value: remaining },
      { label: "Payment status", value: asText(input.payment.status, "CAPTURED") },
    ],
    barcodeValue: number,
    operational: false,
  };
}

export function mapLedgerPaymentDocument(input: {
  payment: {
    id: string;
    partyType: string;
    direction: string;
    amount: unknown;
    method?: string | null;
    reference?: string | null;
    notes?: string | null;
    createdAt?: Date | string | null;
    businessDate?: Date | string | null;
    saleId?: string | null;
    purchaseId?: string | null;
  };
  partyName?: string | null;
  partyPhone?: string | null;
  remainingDue?: unknown;
  previousDue?: unknown;
  relatedNumber?: string | null;
  business?: Parameters<typeof issuerFrom>[1];
  settings?: Parameters<typeof issuerFrom>[2];
  staffName?: string | null;
  branchName?: string | null;
  layout?: DocumentLayout;
}): DocumentPayload {
  const issuerMeta = issuerFrom(undefined, input.business, input.settings);
  const number = documentFilename(asText(input.payment.reference), "PAY", input.payment.id);
  const amount = asMoney(input.payment.amount);
  const remaining = asMoney(input.remainingDue ?? 0);
  const previous = asMoney(input.previousDue ?? remaining);
  const currency = asText((input.settings as { currency?: string } | null | undefined)?.currency, "BDT");
  const related = asText(input.relatedNumber);
  const layout = input.layout ?? "receipt";
  const extras = extrasFrom(issuerMeta);
  return {
    type: "payment",
    layout,
    title: input.payment.direction === "OUT" ? "PAYMENT VOUCHER" : "PAYMENT RECEIPT",
    number,
    filename: number,
    datetime: formatDateTime(input.payment.createdAt ?? input.payment.businessDate),
    businessDate: formatDate(input.payment.businessDate ?? input.payment.createdAt),
    currency,
    ...extras,
    relatedNumber: related || undefined,
    relatedLabel: input.payment.saleId ? "Invoice" : input.payment.purchaseId ? "GRN" : undefined,
    issuer: issuerMeta,
    party: { name: asText(input.partyName, input.payment.partyType), phone: asText(input.partyPhone) || undefined },
    partyLabel: input.payment.partyType === "SUPPLIER" ? "Supplier" : "Customer",
    branchName: input.branchName ?? undefined,
    staffName: input.staffName ?? undefined,
    lines: [],
    subtotal: amount,
    discount: asMoney(0),
    tax: asMoney(0),
    total: amount,
    paid: amount,
    due: remaining,
    change: asMoney(0),
    payments: [{ method: asText(input.payment.method, "CASH"), amount, reference: asText(input.payment.reference) || undefined, datetime: formatDateTime(input.payment.createdAt) }],
    notes: asText(input.payment.notes) || extras.notes,
    paymentHeadline: paymentHeadline(amount, remaining, currency),
    meta: [
      { label: "Receipt", value: number },
      ...(related ? [{ label: input.payment.saleId ? "Invoice" : "Document", value: related }] : []),
      { label: "Payment date", value: formatDateTime(input.payment.createdAt) },
      { label: "Method", value: asText(input.payment.method, "CASH") },
      { label: "Amount paid", value: amount },
      { label: "Previous due", value: previous },
      { label: "Remaining due", value: remaining },
      { label: "Payment status", value: "POSTED" },
      { label: "Direction", value: input.payment.direction },
    ],
    barcodeValue: number,
    operational: input.payment.partyType === "SUPPLIER",
  };
}

export function mapReturnDocument(input: {
  ret: {
    id: string;
    number: string;
    kind?: string | null;
    status?: string | null;
    refundStatus?: string | null;
    reason?: string | null;
    notes?: string | null;
    refundMethod?: string | null;
    refundAmount?: unknown;
    refundedAmount?: unknown;
    createdAt?: Date | string | null;
    items?: Array<{
      qty?: unknown;
      unitPrice?: unknown;
      lineRefund?: unknown;
      condition?: string | null;
      reason?: string | null;
      saleItemId?: string | null;
    }>;
    payments?: Array<{ method?: string; amount?: unknown; status?: string }>;
    sale: SaleLike & { items?: Array<{ id: string; productNameSnapshot?: string; skuSnapshot?: string; variantSnapshot?: string }> };
  };
  business?: Parameters<typeof issuerFrom>[1];
  settings?: Parameters<typeof issuerFrom>[2];
  staffName?: string | null;
  layout?: DocumentLayout;
}): DocumentPayload {
  const issuerMeta = issuerFrom(input.ret.sale.businessSnapshot, input.business, input.settings);
  const currency = asText(input.ret.sale.currency, "BDT");
  const party = partyFrom(input.ret.sale.customerSnapshot, partyFrom(input.ret.sale.customer) ?? { name: "Walk-in" });
  const layout = input.layout ?? "receipt";
  const lines = (input.ret.items ?? []).map((item) => {
    const saleLine = (input.ret.sale.items ?? []).find((s) => s.id === item.saleItemId);
    return lineFrom({
      productNameSnapshot: saleLine?.productNameSnapshot ?? item.reason ?? "Returned item",
      skuSnapshot: saleLine?.skuSnapshot,
      variantSnapshot: saleLine?.variantSnapshot,
      qty: item.qty,
      unitPrice: item.unitPrice,
      lineTotal: item.lineRefund,
      taxAmount: 0,
      discountAmount: 0,
    });
  });
  return {
    type: "return",
    layout,
    title:
      input.ret.kind === "EXCHANGE"
        ? layout === "invoice"
          ? "EXCHANGE / CREDIT NOTE"
          : "EXCHANGE RECEIPT"
        : layout === "invoice"
          ? "RETURN / CREDIT NOTE"
          : "RETURN RECEIPT",
    number: input.ret.number,
    filename: documentFilename(input.ret.number, "RETURN", input.ret.id),
    status: input.ret.status ?? undefined,
    datetime: formatDateTime(input.ret.createdAt),
    currency,
    ...extrasFrom(issuerMeta),
    relatedNumber: input.ret.sale.invoiceNumber,
    relatedLabel: "Original invoice",
    issuer: issuerMeta,
    party,
    partyLabel: "Customer",
    branchName: input.ret.sale.branch?.name ?? undefined,
    staffName: input.staffName ?? undefined,
    lines,
    subtotal: asMoney(input.ret.refundAmount),
    discount: asMoney(0),
    tax: asMoney(0),
    total: asMoney(input.ret.refundAmount),
    paid: asMoney(input.ret.refundedAmount),
    due: asMoney(Number(asText(input.ret.refundAmount, "0")) - Number(asText(input.ret.refundedAmount, "0"))),
    change: asMoney(0),
    payments: (input.ret.payments ?? []).map((p) => ({
      method: asText(p.method, input.ret.refundMethod ?? "CASH"),
      amount: asMoney(p.amount),
      status: p.status,
    })),
    notes: asText(input.ret.notes) || extrasFrom(issuerMeta).notes,
    watermark: watermarkFor(input.ret.status) ?? watermarkFor(input.ret.refundStatus),
    paymentHeadline:
      Number(asText(input.ret.refundAmount, "0")) > 0 && Number(asText(input.ret.refundedAmount, "0")) >= Number(asText(input.ret.refundAmount, "0"))
        ? "REFUNDED IN FULL"
        : undefined,
    meta: [
      { label: "Return", value: input.ret.number },
      { label: "Original invoice", value: input.ret.sale.invoiceNumber },
      { label: "Reason", value: asText(input.ret.reason, "—") },
      { label: "Refund method", value: asText(input.ret.refundMethod, "—") },
      { label: "Refund status", value: asText(input.ret.refundStatus, "—") },
      { label: "Remaining invoice due", value: asMoney(input.ret.sale.due ?? 0) },
    ],
    barcodeValue: input.ret.number,
    operational: false,
  };
}

export function mapPurchaseDocument(input: {
  type?: Extract<DocumentType, "purchase" | "purchase-order" | "purchase-return">;
  id: string;
  number: string;
  title: string;
  status?: string | null;
  createdAt?: Date | string | null;
  businessDate?: Date | string | null;
  notes?: string | null;
  subtotal?: unknown;
  tax?: unknown;
  total?: unknown;
  paid?: unknown;
  due?: unknown;
  reason?: string | null;
  relatedNumber?: string | null;
  supplier?: { name?: string | null; phone?: string | null; email?: string | null; address?: string | null; taxId?: string | null } | null;
  branchName?: string | null;
  staffName?: string | null;
  items: Array<Parameters<typeof lineFrom>[0]>;
  business?: Parameters<typeof issuerFrom>[1];
  settings?: Parameters<typeof issuerFrom>[2];
  layout?: DocumentLayout;
}): DocumentPayload {
  const issuerMeta = issuerFrom(undefined, input.business, input.settings);
  const currency = asText(input.business && "currency" in input.business ? (input.business as { currency?: string }).currency : "BDT", "BDT");
  const type = input.type ?? "purchase";
  const layout = input.layout ?? "invoice";
  const filenamePrefix = type === "purchase-order" ? "PO" : type === "purchase-return" ? "PRN" : "GRN";
  return {
    type,
    layout,
    title: input.title,
    number: input.number,
    filename: documentFilename(input.number, filenamePrefix, input.id),
    status: input.status ?? undefined,
    datetime: formatDateTime(input.createdAt ?? input.businessDate),
    businessDate: formatDate(input.businessDate ?? input.createdAt),
    currency,
    ...extrasFrom(issuerMeta),
    relatedNumber: asText(input.relatedNumber) || undefined,
    relatedLabel: type === "purchase-return" ? "GRN" : type === "purchase" ? "PO" : undefined,
    issuer: issuerMeta,
    party: partyFrom(input.supplier) ?? { name: "Supplier" },
    partyLabel: "Supplier",
    branchName: input.branchName ?? undefined,
    staffName: input.staffName ?? undefined,
    lines: input.items.map(lineFrom),
    subtotal: asMoney(input.subtotal ?? input.total),
    discount: asMoney(0),
    tax: asMoney(input.tax),
    total: asMoney(input.total),
    paid: asMoney(input.paid),
    due: asMoney(input.due),
    change: asMoney(0),
    payments: [],
    notes: asText(input.notes || input.reason) || extrasFrom(issuerMeta).notes,
    watermark: watermarkFor(input.status),
    paymentHeadline: type === "purchase" ? paymentHeadline(input.paid, input.due, currency) : undefined,
    meta: [
      { label: type === "purchase-order" ? "PO" : type === "purchase-return" ? "Return" : "GRN", value: input.number },
      ...(input.relatedNumber ? [{ label: "Reference", value: asText(input.relatedNumber) }] : []),
      ...(input.reason ? [{ label: "Reason", value: asText(input.reason) }] : []),
    ],
    barcodeValue: input.number,
    operational: true,
  };
}
