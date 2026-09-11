import type { SmsRecipientType } from "@prisma/client";

export type SmsTemplateKey =
  | "SALE_CONFIRMATION"
  | "INVOICE_RECEIPT"
  | "PAYMENT_CONFIRMATION"
  | "DUE_REMINDER"
  | "ORDER_STATUS"
  | "ORDER_READY"
  | "RETURN_CONFIRMATION"
  | "EXCHANGE_NOTIFICATION"
  | "LOYALTY_REWARD"
  | "DELIVERY_UPDATE"
  | "MANUAL_CUSTOMER"
  | "PURCHASE_CONFIRMATION"
  | "PURCHASE_RECEIVED"
  | "SUPPLIER_PAYMENT"
  | "SUPPLIER_DUE_REMINDER"
  | "SUPPLIER_PARTIAL_PAYMENT"
  | "SUPPLIER_OUTSTANDING"
  | "PURCHASE_RETURN"
  | "PURCHASE_UPDATE"
  | "MANUAL_SUPPLIER"
  | "STAFF_ALERT";

export type SmsTemplateDef = {
  key: SmsTemplateKey;
  name: string;
  purpose: string;
  recipientType: SmsRecipientType;
  bodyEn: string;
  bodyBn: string;
  enabled: boolean;
};

export const SMS_TEMPLATE_VARS = [
  "shopName",
  "customerName",
  "supplierName",
  "staffName",
  "invoiceNo",
  "amount",
  "dueAmount",
  "paidAmount",
  "refundAmount",
  "paymentDate",
  "orderNo",
  "date",
  "phone",
  "branchName",
  "status",
  "tracking",
  "points",
  "senderName",
] as const;

export type SmsVars = Partial<Record<(typeof SMS_TEMPLATE_VARS)[number], string | number | null | undefined>>;

export const DEFAULT_SMS_TEMPLATES: SmsTemplateDef[] = [
  {
    key: "SALE_CONFIRMATION",
    name: "Sale confirmation",
    purpose: "sale_confirmation",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: Invoice {{invoiceNo}} total {{amount}}. Due {{dueAmount}}. Thank you, {{customerName}}.",
    bodyBn: "{{shopName}}: ইনভয়েস {{invoiceNo}}, মোট {{amount}}। বাকি {{dueAmount}}। ধন্যবাদ {{customerName}}।",
    enabled: true,
  },
  {
    key: "INVOICE_RECEIPT",
    name: "Invoice / payment receipt",
    purpose: "invoice_receipt",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: Receipt for invoice {{invoiceNo}}. Paid {{paidAmount}} on {{paymentDate}}.",
    bodyBn: "{{shopName}}: ইনভয়েস {{invoiceNo}} এর রসিদ। পরিশোধ {{paidAmount}}, তারিখ {{paymentDate}}।",
    enabled: true,
  },
  {
    key: "PAYMENT_CONFIRMATION",
    name: "Payment confirmation",
    purpose: "payment_confirmation",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: Payment of {{amount}} received. Remaining due {{dueAmount}}.",
    bodyBn: "{{shopName}}: {{amount}} পরিশোধ গৃহীত। অবশিষ্ট বাকি {{dueAmount}}।",
    enabled: true,
  },
  {
    key: "DUE_REMINDER",
    name: "Due / payment reminder",
    purpose: "due_reminder",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: Reminder — {{customerName}}, outstanding due is {{dueAmount}}. Invoice {{invoiceNo}}.",
    bodyBn: "{{shopName}}: অনুস্মারণ — {{customerName}}, বকেয়া {{dueAmount}}। ইনভয়েস {{invoiceNo}}।",
    enabled: true,
  },
  {
    key: "ORDER_STATUS",
    name: "Order status update",
    purpose: "order_status",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: Order {{orderNo}} is now {{status}}.",
    bodyBn: "{{shopName}}: অর্ডার {{orderNo}} এখন {{status}}।",
    enabled: true,
  },
  {
    key: "ORDER_READY",
    name: "Order ready",
    purpose: "order_ready",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: Order {{orderNo}} is ready for pickup/delivery.",
    bodyBn: "{{shopName}}: অর্ডার {{orderNo}} নিতে/ডেলিভারির জন্য প্রস্তুত।",
    enabled: true,
  },
  {
    key: "RETURN_CONFIRMATION",
    name: "Return / refund confirmation",
    purpose: "return_confirmation",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: Return {{orderNo}} for invoice {{invoiceNo}} posted. Refund {{refundAmount}}.",
    bodyBn: "{{shopName}}: ইনভয়েস {{invoiceNo}} এর রিটার্ন {{orderNo}} সম্পন্ন। রিফান্ড {{refundAmount}}।",
    enabled: true,
  },
  {
    key: "EXCHANGE_NOTIFICATION",
    name: "Exchange notification",
    purpose: "exchange_notification",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: Exchange completed for invoice {{invoiceNo}}. Ref {{orderNo}}.",
    bodyBn: "{{shopName}}: ইনভয়েস {{invoiceNo}} এর এক্সচেঞ্জ সম্পন্ন। রেফ {{orderNo}}।",
    enabled: true,
  },
  {
    key: "LOYALTY_REWARD",
    name: "Loyalty / reward",
    purpose: "loyalty_reward",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: {{customerName}}, you earned {{points}} loyalty points on invoice {{invoiceNo}}.",
    bodyBn: "{{shopName}}: {{customerName}}, ইনভয়েস {{invoiceNo}} এ আপনি {{points}} লয়ালটি পয়েন্ট পেয়েছেন।",
    enabled: true,
  },
  {
    key: "DELIVERY_UPDATE",
    name: "Delivery / shipping update",
    purpose: "delivery_update",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: Delivery {{status}}. Tracking {{tracking}}. Order {{orderNo}}.",
    bodyBn: "{{shopName}}: ডেলিভারি {{status}}। ট্র্যাকিং {{tracking}}। অর্ডার {{orderNo}}।",
    enabled: true,
  },
  {
    key: "MANUAL_CUSTOMER",
    name: "Manual customer SMS",
    purpose: "manual",
    recipientType: "CUSTOMER",
    bodyEn: "{{shopName}}: {{customerName}}, {{status}}",
    bodyBn: "{{shopName}}: {{customerName}}, {{status}}",
    enabled: true,
  },
  {
    key: "PURCHASE_CONFIRMATION",
    name: "Purchase / order confirmation",
    purpose: "purchase_confirmation",
    recipientType: "SUPPLIER",
    bodyEn: "{{shopName}}: Purchase order {{orderNo}} confirmed. Total {{amount}}.",
    bodyBn: "{{shopName}}: ক্রয় অর্ডার {{orderNo}} নিশ্চিত। মোট {{amount}}।",
    enabled: true,
  },
  {
    key: "PURCHASE_RECEIVED",
    name: "Purchase received",
    purpose: "purchase_received",
    recipientType: "SUPPLIER",
    bodyEn: "{{shopName}}: Goods received against {{invoiceNo}}. Total {{amount}}. Due {{dueAmount}}.",
    bodyBn: "{{shopName}}: {{invoiceNo}} এর মালামাল গৃহীত। মোট {{amount}}। বাকি {{dueAmount}}।",
    enabled: true,
  },
  {
    key: "SUPPLIER_PAYMENT",
    name: "Payment made to supplier",
    purpose: "supplier_payment",
    recipientType: "SUPPLIER",
    bodyEn: "{{shopName}}: Paid {{amount}} to {{supplierName}} on {{paymentDate}}. Remaining {{dueAmount}}.",
    bodyBn: "{{shopName}}: {{supplierName}} কে {{amount}} পরিশোধ ({{paymentDate}})। অবশিষ্ট {{dueAmount}}।",
    enabled: true,
  },
  {
    key: "SUPPLIER_DUE_REMINDER",
    name: "Supplier payment due reminder",
    purpose: "supplier_due_reminder",
    recipientType: "SUPPLIER",
    bodyEn: "{{shopName}}: Reminder — amount due to {{supplierName}} is {{dueAmount}}.",
    bodyBn: "{{shopName}}: অনুস্মারণ — {{supplierName}} কে বকেয়া {{dueAmount}}।",
    enabled: true,
  },
  {
    key: "SUPPLIER_PARTIAL_PAYMENT",
    name: "Partial supplier payment",
    purpose: "supplier_partial_payment",
    recipientType: "SUPPLIER",
    bodyEn: "{{shopName}}: Partial payment {{amount}} posted. Outstanding {{dueAmount}}.",
    bodyBn: "{{shopName}}: আংশিক পরিশোধ {{amount}}। বকেয়া {{dueAmount}}।",
    enabled: true,
  },
  {
    key: "SUPPLIER_OUTSTANDING",
    name: "Outstanding balance reminder",
    purpose: "supplier_outstanding",
    recipientType: "SUPPLIER",
    bodyEn: "{{shopName}}: Outstanding payable to {{supplierName}} is {{dueAmount}} as of {{date}}.",
    bodyBn: "{{shopName}}: {{date}} তারিখে {{supplierName}} কে বকেয়া {{dueAmount}}।",
    enabled: true,
  },
  {
    key: "PURCHASE_RETURN",
    name: "Purchase return / refund",
    purpose: "purchase_return",
    recipientType: "SUPPLIER",
    bodyEn: "{{shopName}}: Purchase return {{orderNo}} against {{invoiceNo}}. Amount {{refundAmount}}.",
    bodyBn: "{{shopName}}: {{invoiceNo}} এর ক্রয় রিটার্ন {{orderNo}}। পরিমাণ {{refundAmount}}।",
    enabled: true,
  },
  {
    key: "PURCHASE_UPDATE",
    name: "Purchase / order update",
    purpose: "purchase_update",
    recipientType: "SUPPLIER",
    bodyEn: "{{shopName}}: Purchase {{orderNo}} update: {{status}}.",
    bodyBn: "{{shopName}}: ক্রয় {{orderNo}} আপডেট: {{status}}।",
    enabled: true,
  },
  {
    key: "MANUAL_SUPPLIER",
    name: "Manual supplier SMS",
    purpose: "manual",
    recipientType: "SUPPLIER",
    bodyEn: "{{shopName}}: {{supplierName}}, {{status}}",
    bodyBn: "{{shopName}}: {{supplierName}}, {{status}}",
    enabled: true,
  },
  {
    key: "STAFF_ALERT",
    name: "Important staff alert",
    purpose: "staff_alert",
    recipientType: "STAFF",
    bodyEn: "{{shopName}}: {{status}} — {{amount}} at {{branchName}} on {{date}}.",
    bodyBn: "{{shopName}}: {{status}} — {{amount}}, {{branchName}}, {{date}}।",
    enabled: false,
  },
];

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderSmsTemplate(body: string, vars: SmsVars): string {
  return body.replace(VAR_RE, (_, key: string) => {
    const value = vars[key as keyof SmsVars];
    if (value == null || value === "") return "";
    return String(value);
  }).replace(/[ \t]{2,}/g, " ").replace(/\s+\./g, ".").trim();
}

export function pickTemplateBody(template: { bodyEn: string; bodyBn: string }, language: string) {
  return language === "bn" ? template.bodyBn || template.bodyEn : template.bodyEn || template.bodyBn;
}

export function isSmsTemplateKey(key: string): key is SmsTemplateKey {
  return DEFAULT_SMS_TEMPLATES.some((t) => t.key === key);
}
