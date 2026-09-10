import type { Response } from "express";
import { Router } from "express";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { ForbiddenError, hasPermission } from "../../lib/scope.js";
import type { AuthedRequest } from "../../types.js";
import { DOCUMENT_TYPES, type DocumentLayout, type DocumentType } from "./document-types.js";
import { loadDocument, loadLogo, permissionFor } from "./documents.service.js";
import { renderReceiptHtml } from "./receipt-html.js";
import { renderInvoiceHtml } from "./invoice-html.js";
import { createPdfDocument, drawPdf, type PdfMode } from "./invoice-pdf.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth, requireTenant);

function isType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

function layoutOf(value: unknown): DocumentLayout {
  const v = String(value ?? "").toLowerCase();
  if (v === "invoice" || v === "a4" || v === "tax") return "invoice";
  return "receipt";
}

function sendError(res: Response, e: unknown) {
  if (res.headersSent) return;
  if (e instanceof ForbiddenError || (e as { code?: string }).code === "FORBIDDEN") {
    return fail(res, "FORBIDDEN", (e as Error).message || "Forbidden", 403);
  }
  if ((e as { code?: string }).code === "NOT_FOUND") {
    return fail(res, "NOT_FOUND", (e as Error).message || "Not found", 404);
  }
  throw e;
}

function assertDocPermission(req: AuthedRequest, type: DocumentType) {
  if (!hasPermission(req.ctx, permissionFor(type))) throw new ForbiddenError("Missing permission");
}

function sendPdf(res: Response, payload: Awaited<ReturnType<typeof loadDocument>>, mode: PdfMode, logo: Buffer | null) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${payload.filename}.pdf"`);
  res.setHeader("Cache-Control", "private, no-store");
  const doc = createPdfDocument(payload, { mode, logo });
  doc.pipe(res);
  drawPdf(doc, payload, { mode, logo });
  doc.end();
}

function sendHtml(res: Response, html: string, filename: string) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `inline; filename="${filename}.html"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(html);
}

async function printDoc(req: AuthedRequest, res: Response, type: DocumentType, id: string, layout: DocumentLayout) {
  assertDocPermission(req, type);
  const payload = await loadDocument({ ctx: req.ctx, type, id, layout });
  const logo = await loadLogo(payload.issuer.logoUrl);
  const autoPrint = req.query.autoprint !== "0";
  const html =
    layout === "invoice"
      ? renderInvoiceHtml(payload, { logoDataUri: logo.dataUri, autoPrint })
      : renderReceiptHtml(payload, { logoDataUri: logo.dataUri, autoPrint });
  sendHtml(res, html, payload.filename);
}

async function pdfDoc(req: AuthedRequest, res: Response, type: DocumentType, id: string, _mode: PdfMode = "a4") {
  assertDocPermission(req, type);
  const payload = await loadDocument({ ctx: req.ctx, type, id, layout: "invoice" });
  const logo = await loadLogo(payload.issuer.logoUrl);
  sendPdf(res, payload, "a4", logo.buffer);
}

documentsRouter.get("/documents/:type/:id/print", async (req, res) => {
  const type = String(req.params.type);
  if (!isType(type)) return fail(res, "NOT_FOUND", "Not found", 404);
  try {
    await printDoc(req as unknown as AuthedRequest, res, type, String(req.params.id), layoutOf(req.query.layout ?? "receipt"));
  } catch (e) {
    sendError(res, e);
  }
});

documentsRouter.get("/documents/:type/:id.pdf", async (req, res) => {
  const type = String(req.params.type);
  if (!isType(type)) return fail(res, "NOT_FOUND", "Not found", 404);
  try {
    await pdfDoc(req as unknown as AuthedRequest, res, type, String(req.params.id), "a4");
  } catch (e) {
    sendError(res, e);
  }
});

documentsRouter.get("/documents/:type/:id", async (req, res) => {
  const type = String(req.params.type);
  if (!isType(type)) return fail(res, "NOT_FOUND", "Not found", 404);
  try {
    assertDocPermission(req as unknown as AuthedRequest, type);
    const payload = await loadDocument({
      ctx: (req as unknown as AuthedRequest).ctx,
      type,
      id: String(req.params.id),
      layout: layoutOf(req.query.layout ?? "invoice"),
    });
    return ok(res, payload);
  } catch (e) {
    sendError(res, e);
  }
});

documentsRouter.get("/sales/:id/documents/print", requirePermission("sale.view"), async (req, res) => {
  try {
    await printDoc(req as unknown as AuthedRequest, res, "sale", String(req.params.id), layoutOf(req.query.kind ?? req.query.layout ?? "receipt"));
  } catch (e) {
    sendError(res, e);
  }
});

documentsRouter.get("/sales/:id/documents/:kind.pdf", requirePermission("sale.view"), async (req, res) => {
  try {
    await pdfDoc(req as unknown as AuthedRequest, res, "sale", String(req.params.id), "a4");
  } catch (e) {
    sendError(res, e);
  }
});

documentsRouter.get("/sales/returns/:id/documents/print", requirePermission("sale.view"), async (req, res) => {
  try {
    await printDoc(req as unknown as AuthedRequest, res, "return", String(req.params.id), layoutOf(req.query.kind ?? req.query.layout ?? "receipt"));
  } catch (e) {
    sendError(res, e);
  }
});

documentsRouter.get("/sales/returns/:id/documents/invoice.pdf", requirePermission("sale.view"), async (req, res) => {
  try {
    await pdfDoc(req as unknown as AuthedRequest, res, "return", String(req.params.id), "a4");
  } catch (e) {
    sendError(res, e);
  }
});
