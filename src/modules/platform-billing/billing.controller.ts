import type { NextFunction, Request, Response } from "express";
import { fail, ok, okList } from "../../utils/response.js";
import { isPlatformActor } from "../../middleware/auth.js";
import type { AuthedRequest } from "../../types.js";
import { loadLogo } from "../documents/documents.service.js";
import { renderInvoiceHtml } from "../documents/invoice-html.js";
import { createPdfDocument, drawPdf } from "../documents/invoice-pdf.js";
import { mapPlatformInvoiceDocument } from "./billing.documents.js";
import {
  createInvoice,
  createTenant,
  getInvoice,
  getPlatformTenant,
  listActivePlans,
  listInvoices,
  listPlatformTenants,
  sendInvoice,
  sendReceipt,
  setInvoiceStatus,
  setTenantApiAccess,
  updateInvoice,
  updateTenant,
} from "./billing.service.js";

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

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

/** HTTP-only. Service error codes map 1:1 via the centralized error middleware. */
export const billingController = {
  async listPlans(_req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await listActivePlans());
    } catch (e) {
      return next(e);
    }
  },

  async listTenants(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await listPlatformTenants(req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createTenant(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await createTenant(ctxOf(req), (req.body ?? {}) as Record<string, unknown>), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async getTenant(req: Request, res: Response, next: NextFunction) {
    try {
      const data = await getPlatformTenant(String(req.params.id));
      if (!data) return fail(res, "NOT_FOUND", "Tenant not found", 404);
      return ok(res, data);
    } catch (e) {
      return next(e);
    }
  },

  async updateTenant(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await updateTenant(ctxOf(req), String(req.params.id), (req.body ?? {}) as Record<string, unknown>));
    } catch (e) {
      return next(e);
    }
  },

  async setApiAccess(req: Request, res: Response, next: NextFunction) {
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
      return next(e);
    }
  },

  async listMyInvoices(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const { rows, pagination } = await listInvoices(req.query as Record<string, unknown>, ctx.tenantId!);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await createInvoice(ctxOf(req), (req.body ?? {}) as Record<string, unknown>), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async listInvoices(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await listInvoices(req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async updateInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await updateInvoice(ctxOf(req), String(req.params.id), (req.body ?? {}) as Record<string, unknown>));
    } catch (e) {
      return next(e);
    }
  },

  async sendInvoice(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await sendInvoice(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async setInvoiceStatus(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await setInvoiceStatus(ctxOf(req), String(req.params.id), (req.body ?? {}) as Record<string, unknown>));
    } catch (e) {
      return next(e);
    }
  },

  async sendReceipt(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await sendReceipt(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async invoicePdf(req: Request, res: Response, next: NextFunction) {
    try {
      await sendInvoicePdf(req, res, "invoice");
    } catch (e) {
      if (!res.headersSent) return next(e);
    }
  },

  async receiptPdf(req: Request, res: Response, next: NextFunction) {
    try {
      await sendInvoicePdf(req, res, "receipt");
    } catch (e) {
      if (!res.headersSent) return next(e);
    }
  },

  async printInvoice(req: Request, res: Response, next: NextFunction) {
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
      return next(e);
    }
  },
};
