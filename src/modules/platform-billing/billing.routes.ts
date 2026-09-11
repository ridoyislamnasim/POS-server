import { Router, type Request, type Response } from "express";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePlatform, requireTenant, isPlatformActor } from "../../middleware/auth.js";
import type { AuthedRequest } from "../../types.js";
import { loadLogo } from "../documents/documents.service.js";
import { renderInvoiceHtml } from "../documents/invoice-html.js";
import { createPdfDocument, drawPdf } from "../documents/invoice-pdf.js";
import { mapPlatformInvoiceDocument } from "./billing.documents.js";
import {
  createInvoice,
  getInvoice,
  getPlatformTenant,
  listInvoices,
  listPlatformTenants,
  sendInvoice,
  sendReceipt,
  setInvoiceStatus,
  setTenantApiAccess,
} from "./billing.service.js";

export const platformBillingRouter = Router();
platformBillingRouter.use(requireAuth);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

function sendFail(res: Response, e: unknown) {
  const err = e as { code?: string; message?: string };
  const code = err.code ?? "INTERNAL";
  const status = code === "NOT_FOUND" ? 404 : code === "PAYMENT_REQUIRED" ? 402 : code === "FORBIDDEN" ? 403 : 400;
  return fail(res, code, err.message || "Request failed", status);
}

platformBillingRouter.get("/tenants", requirePlatform, async (req, res) => {
  const { rows, pagination } = await listPlatformTenants(req.query as Record<string, unknown>);
  return okList(res, rows, pagination);
});

platformBillingRouter.get("/tenants/:id", requirePlatform, async (req, res) => {
  const data = await getPlatformTenant(String(req.params.id));
  if (!data) return fail(res, "NOT_FOUND", "Tenant not found", 404);
  return ok(res, data);
});

platformBillingRouter.post("/tenants/:id/api-access", requirePlatform, async (req, res) => {
  try {
    const enabled = Boolean(req.body?.enabled);
    const reason = req.body?.reason != null ? String(req.body.reason) : undefined;
    const tenant = await setTenantApiAccess(ctxOf(req), String(req.params.id), enabled, reason);
    return ok(res, {
      id: tenant.id,
      name: tenant.name,
      apiAccessEnabled: tenant.apiAccessEnabled,
      apiAccessDisabledAt: tenant.apiAccessDisabledAt,
      apiAccessDisabledReason: tenant.apiAccessDisabledReason,
      subscriptionStatus: tenant.subscriptionStatus,
    });
  } catch (e) {
    return sendFail(res, e);
  }
});

platformBillingRouter.get("/my-invoices", requireTenant, async (req, res) => {
  const ctx = ctxOf(req);
  const { rows, pagination } = await listInvoices(req.query as Record<string, unknown>, ctx.tenantId!);
  return okList(res, rows, pagination);
});

platformBillingRouter.post("/invoices", requirePlatform, async (req, res) => {
  try {
    const row = await createInvoice(ctxOf(req), (req.body ?? {}) as Record<string, unknown>);
    return ok(res, row, undefined, 201);
  } catch (e) {
    return sendFail(res, e);
  }
});

platformBillingRouter.get("/invoices", requirePlatform, async (req, res) => {
  const { rows, pagination } = await listInvoices(req.query as Record<string, unknown>);
  return okList(res, rows, pagination);
});

platformBillingRouter.post("/invoices/:id/send", requirePlatform, async (req, res) => {
  try {
    return ok(res, await sendInvoice(ctxOf(req), String(req.params.id)));
  } catch (e) {
    return sendFail(res, e);
  }
});

platformBillingRouter.post("/invoices/:id/status", requirePlatform, async (req, res) => {
  try {
    return ok(res, await setInvoiceStatus(ctxOf(req), String(req.params.id), (req.body ?? {}) as Record<string, unknown>));
  } catch (e) {
    return sendFail(res, e);
  }
});

platformBillingRouter.post("/invoices/:id/receipt", requirePlatform, async (req, res) => {
  try {
    return ok(res, await sendReceipt(ctxOf(req), String(req.params.id)));
  } catch (e) {
    return sendFail(res, e);
  }
});

async function sendInvoicePdf(req: Request, res: Response, kind: "invoice" | "receipt") {
  const ctx = ctxOf(req);
  const row = await getInvoice(String(req.params.id));
  if (!row) return fail(res, "NOT_FOUND", "Invoice not found", 404);
  if (!isPlatformActor(ctx) && row.tenantId !== ctx.tenantId) {
    return fail(res, "FORBIDDEN", "Forbidden", 403);
  }
  if (kind === "receipt" && row.status !== "PAID") {
    return fail(res, "VALIDATION", "Receipt is available after the invoice is paid");
  }
  const payload = mapPlatformInvoiceDocument(row, kind);
  const logo = await loadLogo(payload.issuer.logoUrl);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  const doc = createPdfDocument(payload, { mode: "a4", logo: logo.buffer });
  doc.pipe(res);
  drawPdf(doc, payload, { mode: "a4", logo: logo.buffer });
  doc.end();
}

platformBillingRouter.get("/invoices/:id/pdf", requireTenant, async (req, res) => {
  try {
    await sendInvoicePdf(req, res, "invoice");
  } catch (e) {
    if (!res.headersSent) sendFail(res, e);
  }
});

platformBillingRouter.get("/invoices/:id/receipt.pdf", requireTenant, async (req, res) => {
  try {
    await sendInvoicePdf(req, res, "receipt");
  } catch (e) {
    if (!res.headersSent) sendFail(res, e);
  }
});

// HTML preview (same access rules as PDF)
platformBillingRouter.get("/invoices/:id/print", requireTenant, async (req, res) => {
  try {
    const ctx = ctxOf(req);
    const row = await getInvoice(String(req.params.id));
    if (!row) return fail(res, "NOT_FOUND", "Invoice not found", 404);
    if (!isPlatformActor(ctx) && row.tenantId !== ctx.tenantId) {
      return fail(res, "FORBIDDEN", "Forbidden", 403);
    }
    const kind = String(req.query.kind ?? "invoice") === "receipt" ? "receipt" : "invoice";
    if (kind === "receipt" && row.status !== "PAID") {
      return fail(res, "VALIDATION", "Receipt is available after the invoice is paid");
    }
    const payload = mapPlatformInvoiceDocument(row, kind);
    const logo = await loadLogo(payload.issuer.logoUrl);
    const html = renderInvoiceHtml(payload, { logoDataUri: logo.dataUri });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(html);
  } catch (e) {
    return sendFail(res, e);
  }
});
