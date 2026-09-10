export const DOCUMENT_TYPES = [
  "sale",
  "sale-payment",
  "payment",
  "return",
  "purchase",
  "purchase-order",
  "purchase-return",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export type DocumentLayout = "receipt" | "invoice";

export type DocumentParty = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
};

export type DocumentLine = {
  name: string;
  sku?: string;
  variant?: string;
  qty: string;
  unitPrice: string;
  discount: string;
  tax: string;
  taxRate: string;
  lineTotal: string;
};

export type DocumentPayment = {
  method: string;
  amount: string;
  status?: string;
  reference?: string;
  datetime?: string;
};

export type DocumentMetaRow = {
  label: string;
  value: string;
};

export type DocumentPayload = {
  type: DocumentType;
  layout: DocumentLayout;
  title: string;
  number: string;
  filename: string;
  status?: string;
  datetime: string;
  businessDate?: string;
  currency: string;
  paperWidthMm: 58 | 80;
  relatedNumber?: string;
  relatedLabel?: string;
  issuer: DocumentParty & { legalName?: string; logoUrl?: string; footer?: string };
  party?: DocumentParty;
  partyLabel?: string;
  branchName?: string;
  staffName?: string;
  lines: DocumentLine[];
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
  paid: string;
  due: string;
  change: string;
  payments: DocumentPayment[];
  notes?: string;
  terms?: string;
  thankYou?: string;
  returnPolicy?: string;
  watermark?: string;
  paymentHeadline?: string;
  meta: DocumentMetaRow[];
  barcodeValue?: string;
  operational: boolean;
  defaultPrintLayout: DocumentLayout;
};
