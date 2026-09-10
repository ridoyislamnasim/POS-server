import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { tenantId } from "../../lib/erp.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";
import { acceptEnum, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

suppliersRouter.get("/", requirePermission("supplier.view"), async (req, res) => {
  const ctx = ctxOf(req);
  const list = parseListQuery(req.query, { sortable: ["name", "createdAt", "creditDue"], defaultSort: "name", defaultOrder: "asc" });
  const status = acceptEnum(req.query.status, ["ACTIVE", "INACTIVE"] as const);
  const q = list.search;
  const where = {
    tenantId: tenantId(ctx),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [{ name: ilike(q) }, { phone: { contains: q } }, { email: ilike(q) }, { taxId: ilike(q) }],
        }
      : {}),
  };
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.supplier.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          email: true,
          address: true,
          taxId: true,
          creditDue: true,
          status: true,
          createdAt: true,
        },
        orderBy: list.sortBy === "creditDue" || list.sortBy === "createdAt" ? { [list.sortBy]: list.sortOrder } : { name: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.supplier.count({ where }),
  });
  return okList(res, rows, pagination);
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
