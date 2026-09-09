import { Router } from "express";
import PDFDocument from "pdfkit";
import { fail } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { ForbiddenError } from "../../lib/scope.js";
import type { AuthedRequest } from "../../types.js";
import { saleRepository } from "../sales/sale.repository.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth, requireTenant);

documentsRouter.get("/sales/:id/documents/:kind.pdf", requirePermission("sale.view"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const kind = String(req.params.kind).toUpperCase() === "BILL" ? "BILL" : "INVOICE";
  try {
    const sale = await saleRepository.getById(ctx, String(req.params.id));
    const docRow = sale.documents.find((d) => d.kind === kind);
    const snap = (docRow?.snapshot ?? {}) as {
      sale?: typeof sale;
    };
    const frozen = snap.sale ?? sale;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${kind.toLowerCase()}-${frozen.invoiceNumber}.pdf"`,
    );

    const doc = new PDFDocument({ size: kind === "BILL" ? [226, 600] : "A4", margin: kind === "BILL" ? 16 : 48 });
    doc.pipe(res);
    const biz = (frozen.businessSnapshot ?? {}) as Record<string, string>;
    doc.fontSize(kind === "BILL" ? 11 : 16).text(biz.name ?? "Business");
    doc.fontSize(9).text(biz.address ?? "");
    doc.text(`VAT: ${biz.vatId ?? "-"}`);
    doc.moveDown();
    doc.fontSize(12).text(kind === "BILL" ? "BILL / RECEIPT" : "TAX INVOICE");
    doc.fontSize(9).text(`No. ${frozen.invoiceNumber}`);
    doc.text(`Branch: ${sale.branch.name}`);
    doc.text(`Date: ${new Date(frozen.businessDate).toISOString().slice(0, 10)}`);
    doc.moveDown();
    for (const item of frozen.items) {
      doc.text(`${item.productNameSnapshot} ${item.variantSnapshot}`);
      doc.text(`  ${item.qty} x ${item.unitPrice} = ${item.lineTotal}`);
    }
    doc.moveDown();
    doc.text(`Subtotal ${frozen.subtotal}`);
    doc.text(`Tax ${frozen.tax}`);
    doc.text(`Total ${frozen.total} ${frozen.currency}`);
    doc.text(`Paid ${frozen.paid}`);
    if (docRow) doc.text(`Document v${docRow.version}`);
    doc.end();
  } catch (e) {
    if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
    throw e;
  }
});
