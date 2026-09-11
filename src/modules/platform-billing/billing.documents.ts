import type { PlatformInvoice, Tenant } from "@prisma/client";
import type { DocumentPayload } from "../documents/document-types.js";

type InvoiceWithTenant = PlatformInvoice & {
  tenant: Tenant & {
    businesses?: { name: string; legalName?: string | null; address?: string | null; email?: string | null; phone?: string | null; vatId?: string | null }[];
    plan?: { name: string; code: string } | null;
  };
};

function money(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n.toFixed(2) : "0.00";
}

function dateLabel(value: Date) {
  return value.toISOString().slice(0, 10);
}

function lineItems(invoice: PlatformInvoice) {
  const raw = invoice.lines;
  if (Array.isArray(raw) && raw.length) {
    return raw.map((row) => {
      const rec = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
      const qty = Number(rec.qty ?? 1) || 1;
      const unitPrice = Number(rec.unitPrice ?? rec.amount ?? invoice.amount) || 0;
      const name = String(rec.name ?? rec.description ?? "Subscription");
      return {
        name,
        sku: String(rec.sku ?? ""),
        variant: "",
        qty: String(qty),
        unitPrice: money(unitPrice),
        discount: "0.00",
        tax: "0.00",
        taxRate: "0",
        lineTotal: money(qty * unitPrice),
      };
    });
  }
  const period = `${dateLabel(invoice.periodStart)} – ${dateLabel(invoice.periodEnd)}`;
  return [
    {
      name: `Platform subscription ${period}`,
      sku: invoice.number,
      variant: "",
      qty: "1",
      unitPrice: money(invoice.amount),
      discount: "0.00",
      tax: "0.00",
      taxRate: "0",
      lineTotal: money(invoice.amount),
    },
  ];
}

export function mapPlatformInvoiceDocument(invoice: InvoiceWithTenant, kind: "invoice" | "receipt"): DocumentPayload {
  const business = invoice.tenant.businesses?.[0];
  const amount = money(invoice.amount);
  const paid = invoice.status === "PAID" ? amount : "0.00";
  const due = invoice.status === "PAID" ? "0.00" : amount;
  const issuerName = process.env.PLATFORM_ISSUER_NAME ?? "POS Platform";
  return {
    type: "sale",
    layout: "invoice",
    title: kind === "receipt" ? "Payment receipt" : "Platform invoice",
    number: invoice.number,
    filename: kind === "receipt" ? `platform-receipt-${invoice.number}` : `platform-invoice-${invoice.number}`,
    status: invoice.status,
    datetime: (invoice.paidAt ?? invoice.sentAt ?? invoice.createdAt).toISOString(),
    businessDate: dateLabel(invoice.periodEnd),
    currency: invoice.currency,
    paperWidthMm: 80,
    relatedNumber: invoice.tenant.name,
    relatedLabel: "Tenant",
    issuer: {
      name: issuerName,
      legalName: issuerName,
      email: process.env.PLATFORM_ISSUER_EMAIL ?? undefined,
      footer: kind === "receipt" ? "Payment received. Thank you." : "Please pay by the due date to keep API access.",
    },
    party: {
      name: business?.legalName || business?.name || invoice.tenant.name,
      email: business?.email ?? undefined,
      phone: business?.phone ?? undefined,
      address: business?.address ?? undefined,
      taxId: business?.vatId ?? undefined,
    },
    partyLabel: "Bill to",
    lines: lineItems(invoice),
    subtotal: amount,
    discount: "0.00",
    tax: "0.00",
    total: amount,
    paid,
    due,
    change: "0.00",
    payments:
      invoice.status === "PAID"
        ? [{ method: invoice.paidNote || "Offline", amount, status: "PAID", datetime: invoice.paidAt?.toISOString() }]
        : [],
    notes: invoice.notes ?? undefined,
    terms: "Offline payment. Platform owner marks the invoice paid after verification.",
    thankYou: kind === "receipt" ? "Payment confirmed." : "Thank you for using the platform.",
    paymentHeadline: invoice.status,
    watermark: invoice.status === "VOID" ? "VOID" : invoice.status === "PAID" && kind === "receipt" ? "PAID" : undefined,
    meta: [
      { label: "Invoice", value: invoice.number },
      { label: "Period", value: `${dateLabel(invoice.periodStart)} – ${dateLabel(invoice.periodEnd)}` },
      { label: "Due", value: dateLabel(invoice.dueDate) },
      { label: "Plan", value: invoice.tenant.plan?.name ?? "—" },
      { label: "Status", value: invoice.status },
    ],
    barcodeValue: invoice.number,
    operational: false,
    defaultPrintLayout: "invoice",
  };
}
