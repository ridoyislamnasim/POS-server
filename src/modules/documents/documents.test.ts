import { describe, expect, it } from "vitest";
import { documentFilename, escapeHtml, paperWidthMm, paymentHeadline, watermarkFor } from "./document-format.js";
import { mapSaleDocument } from "./document-mapper.js";
import { renderReceiptHtml } from "./receipt-html.js";
import { renderInvoiceHtml } from "./invoice-html.js";
import { pdfBuffer } from "./invoice-pdf.js";

describe("document format", () => {
  it("keeps invoice numbers as filenames", () => {
    expect(documentFilename("POS-INV-2026-000123", "INV", "abc")).toBe("POS-INV-2026-000123");
    expect(documentFilename("PAY-000123", "PAY", "x")).toBe("PAY-000123");
    expect(documentFilename("../etc/passwd", "INV", "zzzzzzzzzzzz")).toBe("etc-passwd");
  });

  it("reads 58/80mm from settings", () => {
    expect(paperWidthMm({ receiptWidthMm: 58 })).toBe(58);
    expect(paperWidthMm({ receiptWidthMm: 80 })).toBe(80);
    expect(paperWidthMm({ invoiceTemplate: "THERMAL_58" })).toBe(58);
    expect(paperWidthMm({})).toBe(80);
  });

  it("builds payment headlines from stored paid/due", () => {
    expect(paymentHeadline("500", "0")).toBe("PAID IN FULL");
    expect(paymentHeadline("200", "300")).toContain("REMAINING DUE");
  });

  it("escapes html", () => {
    expect(escapeHtml(`<img src=x onerror=alert(1)>`)).not.toContain("<img");
  });

  it("watermarks voided sales", () => {
    expect(watermarkFor("VOIDED")).toBe("VOIDED");
  });
});

describe("sale mapper", () => {
  const sale = {
    id: "sale1",
    invoiceNumber: "INV-000111",
    status: "COMPLETED",
    currency: "BDT",
    createdAt: "2026-09-10T10:00:00.000Z",
    businessDate: "2026-09-10",
    subtotal: "100.0000",
    discount: "5.0000",
    tax: "15.0000",
    total: "110.0000",
    paid: "60.0000",
    due: "50.0000",
    change: "0.0000",
    businessSnapshot: { name: "Nokshi", address: "Dhaka", phone: "01", vatId: "BIN-1" },
    customerSnapshot: { name: "Amina", phone: "017" },
    items: [
      {
        productNameSnapshot: "Silk Saree",
        skuSnapshot: "SAR-1",
        variantSnapshot: "Red",
        qty: "2.0000",
        unitPrice: "50.0000",
        discountAmount: "5.0000",
        taxAmount: "15.0000",
        taxRate: "15",
        lineTotal: "110.0000",
      },
    ],
    payments: [{ method: "CASH", amount: "60.0000", status: "CAPTURED" }],
    branch: { name: "Dhanmondi" },
  };

  it("copies stored totals and does not recompute them", () => {
    const doc = mapSaleDocument({ sale, cashierName: "Rina", settings: { receiptWidthMm: 80, invoiceFooter: "Thank you" } });
    expect(doc.total).toBe("110.00");
    expect(doc.paid).toBe("60.00");
    expect(doc.due).toBe("50.00");
    expect(doc.tax).toBe("15.00");
    expect(doc.discount).toBe("5.00");
    expect(doc.filename).toBe("INV-000111");
    expect(doc.lines[0]?.lineTotal).toBe("110.00");
    expect(doc.paymentHeadline).toContain("REMAINING DUE");
    expect(doc.thankYou).toBe("Thank You!");
    expect(doc.terms).toBe("Thank you");
    expect(doc.defaultPrintLayout).toBe("receipt");
  });

  it("renders thermal html without app chrome", () => {
    const doc = mapSaleDocument({ sale, settings: { receiptWidthMm: 58 } });
    const html = renderReceiptHtml(doc, { autoPrint: false });
    expect(html).toContain("58mm");
    expect(html).toContain("size: 58mm auto");
    expect(html).toContain("INV-000111");
    expect(html).toContain("Silk Saree");
    expect(html).toContain("Thank You!");
    expect(html).not.toContain("sidebar");
    expect(html).not.toContain("size: A4");
    expect(html).not.toContain("<img src=x");
  });

  it("renders a separate A4 invoice html", () => {
    const doc = mapSaleDocument({ sale, layout: "invoice", settings: { receiptWidthMm: 80, invoiceFooter: "Net 7 days" } });
    const html = renderInvoiceHtml(doc, { autoPrint: false });
    expect(html).toContain("size: A4");
    expect(html).toContain("TAX INVOICE");
    expect(html).toContain("Grand total");
    expect(html).toContain("INV-000111");
    expect(html).toContain("Notes");
    expect(html).not.toContain("Terms & conditions");
    expect(html).not.toContain("58mm auto");
    expect(html).not.toContain("sidebar");
  });

  it("renders a4 pdf with stored totals for long lists", async () => {
    const many = {
      ...sale,
      items: Array.from({ length: 100 }, (_, i) => ({
        ...sale.items[0],
        productNameSnapshot: `Product ${i} with a very long boutique name that must wrap`,
      })),
    };
    const doc = mapSaleDocument({ sale: many, settings: { receiptWidthMm: 80 } });
    const buf = await pdfBuffer(doc, { mode: "a4" });
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(buf.length).toBeGreaterThan(1000);
    expect(pdfPageCount(buf)).toBeGreaterThan(1);
  });

  it("keeps a short invoice on one a4 page", async () => {
    const doc = mapSaleDocument({ sale, settings: { receiptWidthMm: 80, invoiceFooter: "Thank you" } });
    const buf = await pdfBuffer(doc, { mode: "a4" });
    expect(buf.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdfPageCount(buf)).toBe(1);
  });
});

function pdfPageCount(buf: Buffer) {
  return (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}
