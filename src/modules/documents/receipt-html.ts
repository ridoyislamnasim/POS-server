import type { DocumentPayload } from "./document-types.js";
import { barcodeMarkup, escapeHtml, formatAmountHtml, printBootScript } from "./document-format.js";

function row(label: string, value: string) {
  if (!value) return "";
  return `<div class="row"><span>${escapeHtml(label)}</span><span>${value}</span></div>`;
}

export function renderReceiptHtml(payload: DocumentPayload, opts: { logoDataUri?: string | null; autoPrint?: boolean } = {}) {
  const mm = payload.paperWidthMm === 58 ? 58 : 80;
  const money = (v: string) => escapeHtml(formatAmountHtml(v, payload.currency));
  const issuer = payload.issuer;
  const logo = opts.logoDataUri
    ? `<img class="logo" src="${opts.logoDataUri}" alt="" />`
    : issuer.logoUrl
      ? `<img class="logo" src="${escapeHtml(issuer.logoUrl)}" alt="" />`
      : "";
  const lines = payload.lines
    .map((l) => {
      const name = [l.name, l.variant].filter(Boolean).join(" · ");
      const disc = Number(l.discount) ? ` − ${money(l.discount)}` : "";
      return `<div class="item">
        <div class="item-name">${escapeHtml(name)}</div>
        ${l.sku ? `<div class="muted sku">${escapeHtml(l.sku)}</div>` : ""}
        <div class="row cols"><span>${escapeHtml(l.qty)} × ${money(l.unitPrice)}${disc}</span><span>${money(l.lineTotal)}</span></div>
      </div>`;
    })
    .join("");
  const payments = payload.payments
    .map((p) => {
      const extra = [p.status, p.reference].filter(Boolean).join(" · ");
      return row(p.method, money(p.amount) + (extra ? ` · ${escapeHtml(extra)}` : ""));
    })
    .join("");
  const meta = payload.meta.map((m) => row(m.label, escapeHtml(m.value))).join("");
  const partyBlock = payload.party
    ? `<div class="block">${escapeHtml(payload.partyLabel ?? "Customer")}: ${escapeHtml(payload.party.name)}
        ${payload.party.phone ? `<div class="muted">${escapeHtml(payload.party.phone)}</div>` : ""}
      </div>`
    : "";
  const headline = payload.paymentHeadline ? `<div class="headline">${escapeHtml(payload.paymentHeadline)}</div>` : "";
  const watermark = payload.watermark ? `<div class="watermark">${escapeHtml(payload.watermark)}</div>` : "";
  const thankYou = payload.thankYou || "Thank You!";
  const returnPolicy = payload.returnPolicy
    ? `<div class="policy">${escapeHtml(payload.returnPolicy)}</div>`
    : "";
  const autoPrint = opts.autoPrint !== false;
  const showPaid = payload.lines.length > 0 || payload.type === "sale" || payload.type === "payment" || payload.type === "sale-payment" || payload.type === "return";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(payload.number)}</title>
  <style>
    @page { size: ${mm}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #cfcfcf; color: #000; }
    body { font: ${mm === 58 ? "11px" : "12px"}/1.22 "Segoe UI", Tahoma, Arial, sans-serif; }
    .sheet { width: ${mm}mm; margin: 10px auto; background: #fff; padding: 2.5mm 2.5mm 6mm; position: relative; }
    .logo { display: block; max-width: ${mm === 58 ? "22mm" : "28mm"}; max-height: 12mm; margin: 0 auto 1.5mm; filter: grayscale(1); }
    h1 { font-size: ${mm === 58 ? "11px" : "13px"}; margin: 2px 0 3px; text-align: center; letter-spacing: .06em; font-weight: 800; }
    .biz { text-align: center; font-weight: 800; font-size: ${mm === 58 ? "12px" : "14px"}; text-transform: uppercase; color: #c2410c; }
    .center, .muted { text-align: center; }
    .muted { color: #111; font-size: ${mm === 58 ? "10px" : "11px"}; }
    .sku { letter-spacing: .02em; }
    hr { border: 0; border-top: 1px dashed #c2410c; margin: 3px 0; }
    .row { display: flex; justify-content: space-between; gap: 6px; }
    .row span:last-child { text-align: right; white-space: nowrap; }
    .head { display: grid; grid-template-columns: 1fr auto auto; gap: 4px; font-size: 10px; font-weight: 700; }
    .item { margin: 2px 0 3px; }
    .item-name { word-break: break-word; font-weight: 600; }
    .totals .row { font-size: ${mm === 58 ? "11px" : "12px"}; }
    .totals .grand { font-weight: 800; font-size: ${mm === 58 ? "12px" : "13px"}; }
    .headline { text-align: center; font-weight: 800; margin: 3px 0; font-size: 10px; }
    .watermark { position: absolute; inset: 26% 6%; font-size: 26px; font-weight: 800; opacity: .11; transform: rotate(-24deg); text-align: center; pointer-events: none; }
    .no-print { display: none; }
    button { font: 13px sans-serif; padding: 6px 12px; }
    svg.barcode { display: block; margin: 4px auto 0; max-width: 100%; }
    .policy, .thanks { text-align: center; font-size: 10px; margin-top: 3px; }
    .thanks { font-weight: 700; }
    @media print {
      html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; height: auto !important; }
      .sheet { margin: 0; width: ${mm}mm; padding: 2mm; }
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="sheet">
    ${watermark}
    ${logo}
    <div class="biz">${escapeHtml(issuer.name)}</div>
    ${issuer.legalName && issuer.legalName !== issuer.name ? `<div class="muted">${escapeHtml(issuer.legalName)}</div>` : ""}
    <div class="muted">${escapeHtml(issuer.address ?? "")}</div>
    <div class="muted">${escapeHtml([issuer.phone, issuer.email].filter(Boolean).join(" · "))}</div>
    ${issuer.taxId ? `<div class="muted">VAT ${escapeHtml(issuer.taxId)}</div>` : ""}
    <h1>${escapeHtml(payload.title)}</h1>
    ${row("Invoice", escapeHtml(payload.number))}
    ${row("Date", escapeHtml(payload.datetime))}
    ${payload.relatedNumber ? row(payload.relatedLabel ?? "Ref", escapeHtml(payload.relatedNumber)) : ""}
    ${payload.branchName ? row("Branch", escapeHtml(payload.branchName)) : ""}
    ${payload.staffName ? row(payload.operational ? "Staff" : "Cashier", escapeHtml(payload.staffName)) : ""}
    ${payload.status ? row("Status", escapeHtml(payload.status)) : ""}
    <hr />
    ${partyBlock}
    ${
      lines
        ? `<hr /><div class="head"><span>ITEM</span><span>QTY</span><span>TOTAL</span></div><hr />${lines}`
        : ""
    }
    <hr />
    ${payload.lines.length ? row("Subtotal", money(payload.subtotal)) : ""}
    ${Number(payload.discount) ? row("Discount", money(payload.discount)) : ""}
    ${Number(payload.tax) ? row("Tax / VAT", money(payload.tax)) : ""}
    <div class="totals">
      <div class="row grand"><span>TOTAL</span><span>${money(payload.total)}</span></div>
      ${showPaid ? row("Paid", money(payload.paid)) : ""}
      ${Number(payload.due) ? row("Due", money(payload.due)) : ""}
      ${Number(payload.change) ? row("Change", money(payload.change)) : ""}
    </div>
    ${headline}
    ${payments ? `<hr />${payments}` : ""}
    ${meta && payload.lines.length === 0 ? `<hr />${meta}` : ""}
    ${payload.notes && payload.operational ? `<hr /><div class="muted">${escapeHtml(payload.notes)}</div>` : ""}
    ${returnPolicy}
    ${!payload.operational ? `<div class="thanks">${escapeHtml(thankYou)}</div>` : ""}
    ${barcodeMarkup(payload.barcodeValue, { height: mm === 58 ? 28 : 36, displayValue: false })}
  </div>
  ${printBootScript(autoPrint)}
</body>
</html>`;
}
