import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { documentsController } from "./documents.controller.js";

export const documentsRouter = Router();
documentsRouter.use(requireAuth, requireTenant);

documentsRouter.get("/documents/:type/:id/print", documentsController.print);
documentsRouter.get("/documents/:type/:id.pdf", documentsController.pdf);
documentsRouter.get("/documents/:type/:id", documentsController.json);
documentsRouter.get("/sales/:id/documents/print", requirePermission("sale.view"), documentsController.printSale);
documentsRouter.get("/sales/:id/documents/:kind.pdf", requirePermission("sale.view"), documentsController.pdfSale);
documentsRouter.get("/sales/returns/:id/documents/print", requirePermission("sale.view"), documentsController.printReturn);
documentsRouter.get("/sales/returns/:id/documents/invoice.pdf", requirePermission("sale.view"), documentsController.pdfReturn);
