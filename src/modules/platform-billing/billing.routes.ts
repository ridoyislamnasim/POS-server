import { Router } from "express";
import { requireAuth, requirePermission, requirePlatform, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { billingController } from "./billing.controller.js";
import { setApiAccessSchema } from "./billing.validation.js";

export const platformBillingRouter = Router();
platformBillingRouter.use(requireAuth);

platformBillingRouter.get("/plans", requirePlatform, billingController.listPlans);
platformBillingRouter.get("/tenants", requirePlatform, billingController.listTenants);
platformBillingRouter.post("/tenants", requirePlatform, billingController.createTenant);
platformBillingRouter.get("/tenants/:id", requirePlatform, billingController.getTenant);
platformBillingRouter.patch("/tenants/:id", requirePlatform, billingController.updateTenant);
platformBillingRouter.post("/tenants/:id/api-access", requirePlatform, validateBody(setApiAccessSchema), billingController.setApiAccess);
platformBillingRouter.get("/my-invoices", requireTenant, requirePermission("plan.manage"), billingController.listMyInvoices);
platformBillingRouter.post("/invoices", requirePlatform, billingController.createInvoice);
platformBillingRouter.get("/invoices", requirePlatform, billingController.listInvoices);
platformBillingRouter.patch("/invoices/:id", requirePlatform, billingController.updateInvoice);
platformBillingRouter.post("/invoices/:id/send", requirePlatform, billingController.sendInvoice);
platformBillingRouter.post("/invoices/:id/status", requirePlatform, billingController.setInvoiceStatus);
platformBillingRouter.post("/invoices/:id/receipt", requirePlatform, billingController.sendReceipt);
platformBillingRouter.get("/invoices/:id/pdf", requireTenant, billingController.invoicePdf);
platformBillingRouter.get("/invoices/:id/receipt.pdf", requireTenant, billingController.receiptPdf);
platformBillingRouter.get("/invoices/:id/print", requireTenant, billingController.printInvoice);
