import type { DocumentPayload } from "./document-types.js";
import { barcodeMarkup, escapeHtml, formatAmountHtml, printBootScript } from "./document-format.js";

function money(payload: DocumentPayload, value: string) {
  return escapeHtml(formatAmountHtml(value, payload.currency));
}

function partyLines(party?: DocumentPayload["party"]) {
  if (!party) return "—";
  return [escapeHtml(party.name), escapeHtml(party.phone ?? ""), escapeHtml(party.email ?? ""), escapeHtml(party.address ?? ""), party.taxId ? `Tax ID ${escapeHtml(party.taxId)}` : ""]
    .filter(Boolean)
    .join("<br />");
}

export function renderInvoiceHtml(payload: DocumentPayload, opts: { logoDataUri?: string | null; autoPrint?: boolean } = {}) {
  const issuer = payload.issuer;
  const logo = opts.logoDataUri
    ? `<img class="logo" src="${opts.logoDataUri}" alt="" />`
    : issuer.logoUrl
      ? `<img class="logo" src="${escapeHtml(issuer.logoUrl)}" alt="" />`
      : "";
  const autoPrint = opts.autoPrint !== false;
  const status = payload.paymentHeadline || payload.status || "";
  const lineRows = payload.lines
    .map((l, i) => {
      const name = [l.name, l.variant].filter(Boolean).join(" · ");
      return `<tr>
        <td class="n">${i + 1}</td>
        <td><div class="iname">${escapeHtml(name)}</div>${l.sku ? `<div class="sku">${escapeHtml(l.sku)}</div>` : ""}</td>
        <td class="num">${escapeHtml(l.qty)}</td>
        <td class="num">${money(payload, l.unitPrice)}</td>
        <td class="num">${Number(l.discount) ? money(payload, l.discount) : "—"}</td>
        <td class="num">${Number(l.tax) ? money(payload, l.tax) : "—"}</td>
        <td class="num">${money(payload, l.lineTotal)}</td>
      </tr>`;
    })
    .join("");
  const metaRows = payload.meta.map((m) => `<tr><th>${escapeHtml(m.label)}</th><td>${escapeHtml(m.value)}</td></tr>`).join("");
  const payRows = payload.payments
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.method)}</td><td>${money(payload, p.amount)}</td><td>${escapeHtml(p.status ?? "—")}</td><td>${escapeHtml(p.reference ?? "—")}</td><td>${escapeHtml(p.datetime ?? "")}</td></tr>`,
    )
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.title)} ${escapeHtml(payload.number)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; color: #111; }
    body { font: 11pt/1.45 "Calibri", "Segoe UI", Arial, sans-serif; background: #d8d8d8; }
    .sheet { width: 210mm; margin: 12px auto; background: #fff; padding: 12mm; position: relative; }
    .band { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; border-bottom: 3px solid #c2410c; padding-bottom: 10px; }
    .logo { max-height: 42px; max-width: 120px; object-fit: contain; }
    .co { font-size: 16pt; font-weight: 700; letter-spacing: .01em; }
    .co-sub { font-size: 9pt; color: #333; margin-top: 2px; }
    .doc-title { text-align: right; }
    .doc-title h1 { margin: 0; font-size: 18pt; letter-spacing: .08em; color: #c2410c; }
    .doc-title .num { font-size: 12pt; font-weight: 700; }
    .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin: 16px 0 14px; }
    .box h2 { margin: 0 0 4px; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; color: #444; }
    table.items { width: 100%; border-collapse: collapse; }
    table.items th { background: #c2410c; color: #fff; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; padding: 7px 6px; text-align: left; }
    table.items td { border-bottom: 1px solid #ddd; padding: 7px 6px; vertical-align: top; font-size: 10pt; }
    table.items tbody tr:nth-child(even) { background: #f7f7f7; }
    .n { width: 22px; color: #555; }
    .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .iname { word-break: break-word; }
    .sku { font-size: 8.5pt; color: #555; }
    .below { display: grid; grid-template-columns: 1.2fr .8fr; gap: 20px; margin-top: 14px; }
    .totals { border: 1px solid #111; }
    .totals div { display: flex; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid #e5e5e5; }
    .totals div:last-child { border-bottom: 0; }
    .totals .grand { font-weight: 800; background: #c2410c; color: #fff; font-size: 12pt; }
    table.pay { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 9.5pt; }
    table.pay th, table.pay td { border: 1px solid #ccc; padding: 5px 6px; text-align: left; }
    table.pay th { background: #f2f2f2; }
    table.kv th { text-align: left; font-weight: 600; padding-right: 10px; color: #444; }
    .notes { margin-top: 12px; font-size: 9.5pt; }
    .notes h2 { font-size: 8.5pt; text-transform: uppercase; letter-spacing: .08em; margin: 0 0 4px; }
    .foot { margin-top: 12px; border-top: 1px solid #bbb; padding-top: 6px; font-size: 8.5pt; color: #444; text-align: center; }
    .watermark { position: absolute; inset: 34% 10%; font-size: 54px; font-weight: 800; opacity: .07; transform: rotate(-24deg); text-align: center; pointer-events: none; }
    .headline { font-weight: 700; margin: 8px 0; }
    .barcode { display: block; margin: 8px auto 0; }
    .no-print { display: none; }
    @media print {
      html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; height: auto !important; }
      .sheet { margin: 0; width: auto; min-height: 0; padding: 0; box-shadow: none; }
      .no-print { display: none !important; }
      thead { display: table-header-group; }
      tr, img, .totals, .below { break-inside: avoid; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    ${payload.watermark ? `<div class="watermark">${escapeHtml(payload.watermark)}</div>` : ""}
    <header class="band">
      <div>
        ${logo}
        <div class="co">${escapeHtml(issuer.name)}</div>
        ${issuer.legalName && issuer.legalName !== issuer.name ? `<div class="co-sub">${escapeHtml(issuer.legalName)}</div>` : ""}
        <div class="co-sub">${escapeHtml(issuer.address ?? "")}</div>
        <div class="co-sub">${escapeHtml([issuer.phone, issuer.email].filter(Boolean).join(" · "))}</div>
        ${issuer.taxId ? `<div class="co-sub">VAT / BIN ${escapeHtml(issuer.taxId)}</div>` : ""}
      </div>
      <div class="doc-title">
        <h1>${escapeHtml(payload.title)}</h1>
        <div class="num">${escapeHtml(payload.number)}</div>
        <div>${escapeHtml(payload.datetime)}</div>
        ${payload.status ? `<div>${escapeHtml(payload.status)}</div>` : ""}
      </div>
    </header>
    <section class="meta">
      <div class="box">
        <h2>${escapeHtml(payload.partyLabel ?? "Bill to")}</h2>
        <div>${partyLines(payload.party)}</div>
      </div>
      <div class="box">
        <h2>Document details</h2>
        ${payload.branchName ? `<div>Branch: ${escapeHtml(payload.branchName)}</div>` : ""}
        ${payload.staffName ? `<div>${payload.operational ? "Prepared by" : "Cashier"}: ${escapeHtml(payload.staffName)}</div>` : ""}
        ${payload.relatedNumber ? `<div>${escapeHtml(payload.relatedLabel ?? "Reference")}: ${escapeHtml(payload.relatedNumber)}</div>` : ""}
        ${payload.businessDate ? `<div>Business date: ${escapeHtml(payload.businessDate)}</div>` : ""}
        <div>Currency: ${escapeHtml(payload.currency)}</div>
      </div>
    </section>
    ${
      payload.lines.length
        ? `<table class="items">
        <thead>
          <tr>
            <th>#</th>
            <th>Description</th>
            <th class="num">Qty</th>
            <th class="num">Unit price</th>
            <th class="num">Discount</th>
            <th class="num">VAT</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>${lineRows}</tbody>
      </table>`
        : `<table class="kv">${metaRows}</table>`
    }
    <div class="below">
      <div>
        ${status ? `<div class="headline">${escapeHtml(status)}</div>` : ""}
        ${
          payload.payments.length
            ? `<h2 style="font-size:8.5pt;text-transform:uppercase;letter-spacing:.08em">Payments</h2>
        <table class="pay">
          <thead><tr><th>Method</th><th>Amount</th><th>Status</th><th>Reference</th><th>Date</th></tr></thead>
          <tbody>${payRows}</tbody>
        </table>`
            : ""
        }
      </div>
      <div class="totals">
        <div><span>Subtotal</span><span>${money(payload, payload.subtotal)}</span></div>
        ${Number(payload.discount) ? `<div><span>Discount</span><span>${money(payload, payload.discount)}</span></div>` : ""}
        ${Number(payload.tax) ? `<div><span>Tax / VAT</span><span>${money(payload, payload.tax)}</span></div>` : ""}
        <div class="grand"><span>Grand total</span><span>${money(payload, payload.total)}</span></div>
        <div><span>Paid</span><span>${money(payload, payload.paid)}</span></div>
        <div><span>Due</span><span>${money(payload, payload.due)}</span></div>
        ${Number(payload.change) ? `<div><span>Change</span><span>${money(payload, payload.change)}</span></div>` : ""}
      </div>
    </div>
    <section class="notes">
      ${payload.notes ? `<h2>Notes</h2><p>${escapeHtml(payload.notes)}</p>` : ""}
      ${payload.terms && payload.terms !== payload.notes ? `<h2>Terms & conditions</h2><p>${escapeHtml(payload.terms)}</p>` : ""}
      ${payload.returnPolicy ? `<h2>Return policy</h2><p>${escapeHtml(payload.returnPolicy)}</p>` : ""}
    </section>
    ${barcodeMarkup(payload.barcodeValue, { height: 42, displayValue: true })}
    <footer class="foot">${payload.operational ? "Internal / supplier document" : "This is a computer-generated invoice. No signature is required."}</footer>
  </div>
  ${printBootScript(autoPrint)}
</body>
</html>`;
}
