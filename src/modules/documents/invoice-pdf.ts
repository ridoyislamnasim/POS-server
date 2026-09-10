import PDFDocument from "pdfkit";
import type { DocumentPayload } from "./document-types.js";
import { formatAmount, thermalWidthPt } from "./document-format.js";

export type PdfMode = "a4" | "thermal";

type DrawOpts = {
  mode: PdfMode;
  logo?: Buffer | null;
};

function money(payload: DocumentPayload, value: string) {
  return formatAmount(value, payload.currency);
}

function wrapName(name: string, variant?: string) {
  return variant ? `${name} · ${variant}` : name;
}

export function createPdfDocument(payload: DocumentPayload, opts: DrawOpts) {
  if (opts.mode === "thermal") {
    const width = thermalWidthPt(payload.paperWidthMm);
    const height = Math.min(3600, 160 + payload.lines.length * 36 + payload.meta.length * 14 + 180);
    return new PDFDocument({ size: [width, height], margin: payload.paperWidthMm === 58 ? 10 : 14 });
  }
  return new PDFDocument({ size: "A4", autoFirstPage: true, margins: { top: 48, left: 48, right: 48, bottom: 56 } });
}

export function drawPdf(doc: PDFKit.PDFDocument, payload: DocumentPayload, opts: DrawOpts) {
  if (opts.mode === "thermal") drawThermal(doc, payload, opts.logo);
  else drawA4(doc, payload, opts.logo);
}

export function pdfBuffer(payload: DocumentPayload, opts: DrawOpts): Promise<Buffer> {
  const doc = createPdfDocument(payload, opts);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      drawPdf(doc, payload, opts);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function drawWatermark(doc: PDFKit.PDFDocument, text?: string) {
  if (!text) return;
  doc.save();
  doc.fillColor("#bbbbbb").fontSize(48).rotate(-28, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.text(text, 80, doc.page.height / 2 - 40, { width: doc.page.width - 160, align: "center", height: 56, lineBreak: false });
  doc.restore();
  doc.fillColor("#111111");
}

function pageBottom(doc: PDFKit.PDFDocument) {
  return doc.page.height - doc.page.margins.bottom - 28;
}

function cell(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  opts: { width?: number; height?: number; align?: "left" | "center" | "right" },
) {
  // Explicit height stops pdfkit from auto-adding pages (which overflows the stack on long invoices).
  doc.text(text, x, y, { lineBreak: false, ...opts });
}

function drawThermal(doc: PDFKit.PDFDocument, payload: DocumentPayload, logo?: Buffer | null) {
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  drawWatermark(doc, payload.watermark);
  if (logo) {
    try {
      doc.image(logo, doc.page.margins.left + width / 2 - 28, doc.y, { width: 56, height: 28, fit: [56, 28] });
      doc.y += 32;
    } catch {
      /* ignore bad logo */
    }
  }
  doc.font("Helvetica-Bold").fontSize(11).text(payload.issuer.name, { align: "center", width });
  doc.font("Helvetica").fontSize(8);
  if (payload.issuer.address) doc.text(payload.issuer.address, { align: "center", width });
  if (payload.issuer.phone) doc.text(payload.issuer.phone, { align: "center", width });
  if (payload.issuer.taxId) doc.text(`VAT ${payload.issuer.taxId}`, { align: "center", width });
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(10).text(payload.title, { align: "center", width });
  doc.font("Helvetica").fontSize(8);
  doc.text(`No. ${payload.number}`, { align: "center", width });
  doc.text(payload.datetime, { align: "center", width });
  if (payload.relatedNumber) doc.text(`${payload.relatedLabel ?? "Ref"}: ${payload.relatedNumber}`, { align: "center", width });
  if (payload.branchName) doc.text(payload.branchName, { align: "center", width });
  if (payload.staffName) doc.text(`${payload.operational ? "Staff" : "Cashier"}: ${payload.staffName}`, { align: "center", width });
  if (payload.party) doc.text(`${payload.partyLabel ?? "Party"}: ${payload.party.name}`, { align: "center", width });
  doc.moveDown(0.3);
  doc.text("-".repeat(payload.paperWidthMm === 58 ? 28 : 36), { align: "center", width });
  for (const line of payload.lines) {
    doc.font("Helvetica").fontSize(8).text(wrapName(line.name, line.variant), { width });
    doc.text(`${line.qty} x ${money(payload, line.unitPrice)}`, { continued: true, width });
    doc.text(money(payload, line.lineTotal), { align: "right" });
  }
  if (payload.lines.length) doc.text("-".repeat(payload.paperWidthMm === 58 ? 28 : 36), { align: "center", width });
  const totals: Array<[string, string]> = [
    ["Total", payload.total],
    ["Paid", payload.paid],
  ];
  if (Number(payload.discount)) totals.unshift(["Discount", payload.discount]);
  if (Number(payload.tax)) totals.unshift(["VAT", payload.tax]);
  if (payload.lines.length) totals.unshift(["Subtotal", payload.subtotal]);
  if (Number(payload.due)) totals.push(["Due", payload.due]);
  if (Number(payload.change)) totals.push(["Change", payload.change]);
  for (const [label, value] of totals) {
    doc.font(label === "Total" ? "Helvetica-Bold" : "Helvetica").fontSize(8);
    doc.text(label, { continued: true, width });
    doc.text(money(payload, value), { align: "right" });
  }
  if (payload.paymentHeadline) {
    doc.moveDown(0.3);
    doc.font("Helvetica-Bold").fontSize(8).text(payload.paymentHeadline.replace(/৳/g, "Tk "), { align: "center", width });
  }
  for (const p of payload.payments) {
    doc.font("Helvetica").fontSize(8).text(p.method, { continued: true, width });
    doc.text(money(payload, p.amount), { align: "right" });
  }
  if (payload.notes) {
    doc.moveDown(0.3);
    doc.font("Helvetica").fontSize(7).text(payload.notes, { align: payload.operational ? "left" : "center", width });
  }
  if (!payload.operational) {
    doc.moveDown(0.2);
    doc.text("Thank you", { align: "center", width });
  }
}

function drawA4(doc: PDFKit.PDFDocument, payload: DocumentPayload, logo?: Buffer | null) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  let tableStarted = false;
  const footerText = payload.operational ? "Internal / supplier document" : "This is a computer-generated invoice. No signature is required.";
  const writePageFooter = () => {
    const savedY = doc.y;
    const margins = doc.page.margins as { top: number; left: number; right: number; bottom: number };
    const prevBottom = margins.bottom;
    margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor("#555");
    cell(doc, footerText, left, doc.page.height - 28, { width, align: "center", height: 10 });
    margins.bottom = prevBottom;
    doc.fillColor("#111");
    doc.y = savedY;
  };

  const drawHeaderBand = () => {
    doc.fillColor("#111111");
    if (logo) {
      try {
        doc.image(logo, left, 40, { fit: [72, 40] });
      } catch {
        /* ignore */
      }
    }
    const textLeft = logo ? left + 84 : left;
    const headerTop = 42;
    doc.font("Helvetica-Bold").fontSize(16);
    cell(doc, payload.issuer.name, textLeft, headerTop, { width: width / 2 - 8, height: 22 });
    const issuerBits = [payload.issuer.legalName, payload.issuer.address, payload.issuer.phone, payload.issuer.email, payload.issuer.taxId ? `VAT ${payload.issuer.taxId}` : ""]
      .filter(Boolean)
      .join("\n");
    doc.font("Helvetica").fontSize(9);
    doc.text(issuerBits, textLeft, headerTop + 22, { width: width / 2 - 8, height: 48, lineGap: 1 });
    doc.font("Helvetica-Bold").fontSize(18);
    doc.fillColor("#c2410c");
    cell(doc, payload.title, left + width / 2, headerTop, { width: width / 2, align: "right", height: 22 });
    doc.fillColor("#111111");
    doc.font("Helvetica").fontSize(10);
    cell(doc, payload.number, left + width / 2, headerTop + 24, { width: width / 2, align: "right", height: 14 });
    doc.fontSize(9);
    cell(doc, payload.datetime, left + width / 2, headerTop + 40, { width: width / 2, align: "right", height: 12 });
    if (payload.status) cell(doc, payload.status, left + width / 2, headerTop + 54, { width: width / 2, align: "right", height: 12 });
    doc.save();
    doc.strokeColor("#c2410c").lineWidth(2.5).moveTo(left, 112).lineTo(left + width, 112).stroke();
    doc.restore();
    doc.y = 118;
  };

  const cols = {
    item: left,
    sku: left + 210,
    qty: left + 292,
    unit: left + 328,
    disc: left + 392,
    tax: left + 448,
    total: left + 500,
  };

  const drawTableHead = () => {
    const y = doc.y;
    doc.save();
    doc.rect(left, y, width, 18).fill("#c2410c");
    doc.restore();
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(8);
    cell(doc, "Item", cols.item + 4, y + 5, { width: 200, height: 10 });
    cell(doc, "SKU", cols.sku, y + 5, { width: 78, height: 10 });
    cell(doc, "Qty", cols.qty, y + 5, { width: 32, align: "right", height: 10 });
    cell(doc, "Unit", cols.unit, y + 5, { width: 58, align: "right", height: 10 });
    cell(doc, "Disc", cols.disc, y + 5, { width: 50, align: "right", height: 10 });
    cell(doc, "VAT", cols.tax, y + 5, { width: 48, align: "right", height: 10 });
    cell(doc, "Total", cols.total, y + 5, { width: right - cols.total, align: "right", height: 10 });
    doc.y = y + 22;
  };

  const paintChrome = () => {
    drawWatermark(doc, payload.watermark);
    drawHeaderBand();
    writePageFooter();
    if (tableStarted) drawTableHead();
  };

  const startNewPage = () => {
    doc.addPage();
    paintChrome();
  };

  const ensureSpace = (need: number) => {
    if (doc.y + need > pageBottom(doc)) startNewPage();
  };

  paintChrome();

  doc.moveDown(0.6);
  const partyY = doc.y;
  doc.font("Helvetica-Bold").fontSize(9);
  cell(doc, payload.partyLabel ?? "Bill to", left, partyY, { width: width / 2 - 12, height: 12 });
  doc.font("Helvetica").fontSize(10);
  cell(doc, payload.party?.name ?? "—", left, partyY + 14, { width: width / 2 - 12, height: 14 });
  const partyBits = [payload.party?.phone, payload.party?.email, payload.party?.address, payload.party?.taxId].filter(Boolean).join("\n");
  doc.fontSize(9);
  if (partyBits) doc.text(partyBits, left, partyY + 30, { width: width / 2 - 12, height: 42, lineGap: 1 });
  const infoX = left + width / 2;
  doc.font("Helvetica-Bold").fontSize(9);
  cell(doc, "Details", infoX, partyY, { width: width / 2, height: 12 });
  const details = [
    payload.branchName ? `Branch: ${payload.branchName}` : "",
    payload.staffName ? `${payload.operational ? "Staff" : "Cashier"}: ${payload.staffName}` : "",
    payload.relatedNumber ? `${payload.relatedLabel ?? "Reference"}: ${payload.relatedNumber}` : "",
    payload.businessDate ? `Business date: ${payload.businessDate}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  doc.font("Helvetica").fontSize(9);
  if (details) doc.text(details, infoX, partyY + 14, { width: width / 2, height: 56, lineGap: 1 });
  doc.y = Math.max(partyY + 72, 190);
  doc.moveDown(0.4);

  if (payload.lines.length) {
    tableStarted = true;
    ensureSpace(28);
    drawTableHead();
    payload.lines.forEach((line, i) => {
      const name = wrapName(line.name, line.variant);
      doc.font("Helvetica").fontSize(8);
      const nameH = Math.min(36, Math.max(12, doc.heightOfString(name, { width: 196 })));
      const rowH = Math.max(16, nameH + 6);
      ensureSpace(rowH);
      const y = doc.y;
      if (i % 2 === 1) {
        doc.save();
        doc.rect(left, y - 2, width, rowH).fill("#fafafa");
        doc.restore();
      }
      doc.fillColor("#111").font("Helvetica").fontSize(8);
      doc.text(name, cols.item + 4, y, { width: 196, height: rowH, lineGap: 1 });
      cell(doc, line.sku ?? "", cols.sku, y, { width: 78, height: 12 });
      cell(doc, line.qty, cols.qty, y, { width: 32, align: "right", height: 12 });
      cell(doc, money(payload, line.unitPrice), cols.unit, y, { width: 58, align: "right", height: 12 });
      cell(doc, money(payload, line.discount), cols.disc, y, { width: 50, align: "right", height: 12 });
      cell(doc, money(payload, line.tax), cols.tax, y, { width: 48, align: "right", height: 12 });
      cell(doc, money(payload, line.lineTotal), cols.total, y, { width: right - cols.total, align: "right", height: 12 });
      doc.y = y + rowH;
    });
    tableStarted = false;
  }

  ensureSpace(96);
  doc.moveDown(0.4);
  const boxWidth = 220;
  const boxLeft = right - boxWidth;
  const addTotal = (label: string, value: string, bold = false) => {
    ensureSpace(16);
    const y = doc.y;
    doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(10);
    cell(doc, label, boxLeft, y, { width: 100, height: 14 });
    cell(doc, money(payload, value), boxLeft + 100, y, { width: 120, align: "right", height: 14 });
    doc.y = y + 16;
  };
  addTotal("Subtotal", payload.subtotal);
  if (Number(payload.discount)) addTotal("Discount", payload.discount);
  if (Number(payload.tax)) addTotal("VAT", payload.tax);
  addTotal("Grand total", payload.total, true);
  addTotal("Paid", payload.paid);
  addTotal("Due", payload.due);
  if (Number(payload.change)) addTotal("Change", payload.change);

  if (payload.paymentHeadline) {
    ensureSpace(20);
    doc.moveDown(0.4);
    const y = doc.y;
    doc.font("Helvetica-Bold").fontSize(10);
    cell(doc, payload.paymentHeadline.replace(/৳/g, "Tk "), left, y, { width, height: 14 });
    doc.y = y + 16;
  }

  if (payload.payments.length) {
    ensureSpace(20 + payload.payments.length * 14);
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(10);
    cell(doc, "Payments", left, doc.y, { width, height: 14 });
    doc.y += 16;
    doc.font("Helvetica").fontSize(9);
    for (const p of payload.payments) {
      ensureSpace(14);
      const y = doc.y;
      const line = `${p.method}  ${money(payload, p.amount)}${p.status ? `  (${p.status})` : ""}${p.reference ? `  Ref ${p.reference}` : ""}`;
      cell(doc, line, left, y, { width, height: 12 });
      doc.y = y + 14;
    }
  }

  if (payload.meta.length && payload.lines.length === 0) {
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(9);
    for (const m of payload.meta) {
      ensureSpace(14);
      const y = doc.y;
      cell(doc, `${m.label}: ${m.value}`, left, y, { width, height: 12 });
      doc.y = y + 14;
    }
  }

  if (payload.notes || payload.terms || payload.returnPolicy || payload.thankYou) {
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(8).fillColor("#333");
    const block = (title: string, body: string) => {
      const h = Math.min(64, Math.max(22, doc.heightOfString(body, { width }) + 16));
      ensureSpace(h);
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8);
      cell(doc, title, left, y, { width, height: 12 });
      doc.font("Helvetica");
      doc.text(body, left, y + 12, { width, height: h - 12 });
      doc.y = y + h;
    };
    if (payload.notes) block("Notes", payload.notes);
    if (payload.terms && payload.terms !== payload.notes) block("Terms & conditions", payload.terms);
    if (payload.returnPolicy) block("Return policy", payload.returnPolicy);
    if (payload.thankYou && !payload.operational) {
      ensureSpace(16);
      const y = doc.y;
      doc.font("Helvetica-Bold").fontSize(8);
      cell(doc, payload.thankYou, left, y, { width, align: "center", height: 12 });
      doc.y = y + 16;
    }
  }
}
