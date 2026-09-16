import type { NextFunction, Request, Response } from "express";
import { fail, ok } from "../../utils/response.js";
import { ForbiddenError, hasPermission } from "../../lib/scope.js";
import type { AuthedRequest } from "../../types.js";
import { DOCUMENT_TYPES, type DocumentLayout, type DocumentType } from "./document-types.js";
import { loadDocument, loadLogo, permissionFor } from "./documents.service.js";
import { renderReceiptHtml } from "./receipt-html.js";
import { renderInvoiceHtml } from "./invoice-html.js";
import { createPdfDocument, drawPdf, type PdfMode } from "./invoice-pdf.js";

function isType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

function layoutOf(value: unknown): DocumentLayout {
  const v = String(value ?? "").toLowerCase();
  if (v === "invoice" || v === "a4" || v === "tax") return "invoice";
  return "receipt";
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

async function pdfDoc(req: AuthedRequest, res: Response, type: DocumentType, id: string) {
  assertDocPermission(req, type);
  const payload = await loadDocument({ ctx: req.ctx, type, id, layout: "invoice" });
  const logo = await loadLogo(payload.issuer.logoUrl);
  sendPdf(res, payload, "a4", logo.buffer);
}

function docTypeOr404(req: Request, res: Response): DocumentType | undefined {
  const type = String(req.params.type);
  if (!isType(type)) {
    fail(res, "NOT_FOUND", "Not found", 404);
    return undefined;
  }
  return type;
}

/** HTTP-only: content negotiation + permission gates + streaming. */
export const documentsController = {
  async print(req: Request, res: Response, next: NextFunction) {
    try {
      const type = docTypeOr404(req, res);
      if (!type) return;
      await printDoc(req as unknown as AuthedRequest, res, type, String(req.params.id), layoutOf(req.query.layout ?? "receipt"));
    } catch (e) {
      return next(e);
    }
  },

  async pdf(req: Request, res: Response, next: NextFunction) {
    try {
      const type = docTypeOr404(req, res);
      if (!type) return;
      await pdfDoc(req as unknown as AuthedRequest, res, type, String(req.params.id));
    } catch (e) {
      return next(e);
    }
  },

  async json(req: Request, res: Response, next: NextFunction) {
    try {
      const type = docTypeOr404(req, res);
      if (!type) return;
      const authed = req as unknown as AuthedRequest;
      assertDocPermission(authed, type);
      return ok(
        res,
        await loadDocument({ ctx: authed.ctx, type, id: String(req.params.id), layout: layoutOf(req.query.layout ?? "invoice") }),
      );
    } catch (e) {
      return next(e);
    }
  },

  async printSale(req: Request, res: Response, next: NextFunction) {
    try {
      await printDoc(
        req as unknown as AuthedRequest,
        res,
        "sale",
        String(req.params.id),
        layoutOf(req.query.kind ?? req.query.layout ?? "receipt"),
      );
    } catch (e) {
      return next(e);
    }
  },

  async pdfSale(req: Request, res: Response, next: NextFunction) {
    try {
      await pdfDoc(req as unknown as AuthedRequest, res, "sale", String(req.params.id));
    } catch (e) {
      return next(e);
    }
  },

  async printReturn(req: Request, res: Response, next: NextFunction) {
    try {
      await printDoc(
        req as unknown as AuthedRequest,
        res,
        "return",
        String(req.params.id),
        layoutOf(req.query.kind ?? req.query.layout ?? "receipt"),
      );
    } catch (e) {
      return next(e);
    }
  },

  async pdfReturn(req: Request, res: Response, next: NextFunction) {
    try {
      await pdfDoc(req as unknown as AuthedRequest, res, "return", String(req.params.id));
    } catch (e) {
      return next(e);
    }
  },
};
