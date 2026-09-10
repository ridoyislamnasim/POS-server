import type { DocumentPayload } from "./document-types.js";

export function asText(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "object" && value !== null && "toString" in value) return String(value);
  return fallback;
}

export function asMoney(value: unknown): string {
  const raw = asText(value, "0");
  const n = Number(raw);
  if (!Number.isFinite(n)) return "0.00";
  return n.toFixed(2);
}

export function asQty(value: unknown): string {
  const n = Number(asText(value, "0"));
  if (!Number.isFinite(n)) return asText(value, "0");
  if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
  return String(n);
}

export function moneyNumber(value: unknown): number {
  const n = Number(asText(value, "0"));
  return Number.isFinite(n) ? n : 0;
}

export function formatAmount(value: unknown, currency = "BDT"): string {
  const n = moneyNumber(value);
  const formatted = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === "BDT") return `Tk ${formatted}`;
  return `${currency} ${formatted}`;
}

export function formatAmountHtml(value: unknown, currency = "BDT"): string {
  const n = moneyNumber(value);
  const formatted = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (currency === "BDT") return `৳${formatted}`;
  return `${currency} ${formatted}`;
}

export function formatDateTime(value: unknown, timeZone = "Asia/Dhaka"): string {
  const d = value instanceof Date ? value : new Date(asText(value));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export function formatDate(value: unknown, timeZone = "Asia/Dhaka"): string {
  const d = value instanceof Date ? value : new Date(asText(value));
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(d);
}

export function settingsNotes(settings?: { notifications?: unknown } | null): Record<string, unknown> {
  return settings?.notifications && typeof settings.notifications === "object" && !Array.isArray(settings.notifications)
    ? (settings.notifications as Record<string, unknown>)
    : {};
}

export function paperWidthMm(settings?: {
  receiptWidthMm?: unknown;
  invoiceTemplate?: unknown;
  receiptPrinter?: unknown;
  notifications?: unknown;
} | null): 58 | 80 {
  const notes = settingsNotes(settings);
  const n = Number(settings?.receiptWidthMm ?? notes.receiptWidthMm);
  if (n === 58 || n === 80) return n;
  const blob = `${asText(settings?.invoiceTemplate)} ${asText(settings?.receiptPrinter)}`.toUpperCase();
  if (blob.includes("58")) return 58;
  return 80;
}

export function defaultPrintLayout(settings?: { notifications?: unknown } | null): "receipt" | "invoice" {
  const v = asText(settingsNotes(settings).defaultPrintType).toLowerCase();
  return v === "a4" || v === "invoice" ? "invoice" : "receipt";
}

export function thankYouMessage(settings?: { notifications?: unknown; invoiceFooter?: string | null } | null): string {
  return asText(settingsNotes(settings).thankYouMessage, "Thank You!");
}

export function returnPolicyText(settings?: { notifications?: unknown } | null): string {
  return asText(settingsNotes(settings).returnPolicy);
}

export function printBootScript(autoPrint: boolean): string {
  if (!autoPrint) return "";
  return `<script>
    function posGoPrint() { try { window.focus(); window.print(); } catch (e) {} }
    function posWaitAssets(cb) {
      var imgs = Array.prototype.slice.call(document.images || []);
      var pending = imgs.filter(function (img) { return !img.complete; });
      if (!pending.length) { cb(); return; }
      var left = pending.length;
      var done = function () { left -= 1; if (left <= 0) cb(); };
      pending.forEach(function (img) {
        img.addEventListener("load", done);
        img.addEventListener("error", done);
      });
      setTimeout(cb, 2500);
    }
    function posBootPrint() { posWaitAssets(function () { setTimeout(posGoPrint, 80); }); }
    if (document.readyState === "complete") posBootPrint();
    else window.addEventListener("load", posBootPrint);
  </script>`;
}

export function barcodeMarkup(value: string | undefined, opts: { height?: number; displayValue?: boolean } = {}): string {
  if (!value) return "";
  const height = opts.height ?? 36;
  const displayValue = opts.displayValue !== false;
  return `<svg id="bc" class="barcode"></svg>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"></script>
  <script>
    try {
      if (window.JsBarcode) JsBarcode("#bc", ${JSON.stringify(value)}, {
        format: "CODE128",
        width: 1.15,
        height: ${height},
        displayValue: ${displayValue ? "true" : "false"},
        fontSize: 10,
        margin: 0
      });
    } catch (e) {}
  </script>`;
}

export function documentFilename(number: string, fallbackPrefix: string, id: string): string {
  const cleaned = asText(number)
    .replace(/[^\w.\-]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/^-+|-+$/g, "")
    .replace(/\.\.+/g, ".")
    .slice(0, 80);
  if (cleaned) return cleaned;
  const tail = asText(id).replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase() || "DOC";
  return `${fallbackPrefix}-${tail}`;
}

export function paymentHeadline(paid: unknown, due: unknown, currency = "BDT"): string {
  if (moneyNumber(due) <= 0 && moneyNumber(paid) > 0) return "PAID IN FULL";
  if (moneyNumber(due) > 0) {
    return `PAID: ${formatAmountHtml(paid, currency)}    REMAINING DUE: ${formatAmountHtml(due, currency)}`;
  }
  return "";
}

export function watermarkFor(status?: string | null): string | undefined {
  const s = asText(status).toUpperCase();
  if (s === "VOIDED") return "VOIDED";
  if (s === "CANCELLED" || s === "CANCELED") return "CANCELLED";
  if (s === "FULLY_RETURNED") return "RETURNED";
  if (s === "REJECTED") return "REJECTED";
  if (s === "REFUNDED") return "REFUNDED";
  return undefined;
}

export function escapeHtml(value: unknown): string {
  return asText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function thermalWidthPt(mm: 58 | 80): number {
  return mm === 58 ? 164 : 227;
}

export function isDocumentPayload(value: unknown): value is DocumentPayload {
  return Boolean(value && typeof value === "object" && "filename" in value && "lines" in value);
}
