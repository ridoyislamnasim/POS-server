import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { tenantId } from "../../lib/erp.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

suppliersRouter.get("/", requirePermission("supplier.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const q = String(req.query.q ?? "").trim();
  const rows = await prisma.supplier.findMany({
    where: {
      tenantId: tenantId(ctx),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { phone: { contains: q } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    take: 200,
  });
  return ok(res, rows);
});

suppliersRouter.get("/:id", requirePermission("supplier.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const row = await prisma.supplier.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
    include: {
      purchases: { orderBy: { createdAt: "desc" }, take: 50, include: { items: true } },
      purchaseOrders: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!row) return fail(res, "NOT_FOUND", "Supplier not found", 404);
  const payments = await prisma.ledgerPayment.findMany({
    where: { tenantId: tenantId(ctx), partyType: "SUPPLIER", partyId: row.id },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return ok(res, { ...row, payments });
});

suppliersRouter.post("/", requirePermission("supplier.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { name, phone, email, address, taxId, notes } = req.body ?? {};
  if (!name) return fail(res, "VALIDATION", "name required");
  const row = await prisma.supplier.create({
    data: { tenantId: tenantId(ctx), name, phone, email, address, taxId, notes },
  });
  return ok(res, row, undefined, 201);
});

suppliersRouter.patch("/:id", requirePermission("supplier.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.supplier.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Supplier not found", 404);
  const { name, phone, email, address, taxId, notes, status } = req.body ?? {};
  const row = await prisma.supplier.update({
    where: { id: existing.id },
    data: { name, phone, email, address, taxId, notes, status },
  });
  return ok(res, row);
});

suppliersRouter.delete("/:id", requirePermission("supplier.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.supplier.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Supplier not found", 404);
  const purchases = await prisma.purchase.count({ where: { supplierId: existing.id } });
  if (purchases > 0) return fail(res, "CONFLICT", "This supplier has purchases and cannot be deleted", 409);
  const orders = await prisma.purchaseOrder.count({ where: { supplierId: existing.id } });
  if (orders > 0) return fail(res, "CONFLICT", "This supplier has purchase orders and cannot be deleted", 409);
  await prisma.supplier.delete({ where: { id: existing.id } });
  await writeAudit({ ctx, action: "supplier.delete", entityType: "Supplier", entityId: existing.id, before: { name: existing.name } });
  return ok(res, { id: existing.id });
});
