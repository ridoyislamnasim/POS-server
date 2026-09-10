import { Router } from "express";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { ForbiddenError } from "../../lib/scope.js";
import { prisma } from "../../lib/prisma.js";
import { tenantId } from "../../lib/erp.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";
import { customerRepository } from "./customer.repository.js";
import { normalizeBdPhone } from "../../shared/phone.js";

export const customersRouter = Router();
customersRouter.use(requireAuth, requireTenant);

function canLookupCustomers(ctx: AuthedRequest["ctx"]) {
  return (
    ctx.isPlatform ||
    ctx.roles.includes("TENANT_OWNER") ||
    ctx.permissions.includes("customer.view") ||
    ctx.permissions.includes("sale.create")
  );
}

customersRouter.get("/", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  if (!canLookupCustomers(ctx)) return fail(res, "FORBIDDEN", "Missing permission", 403);
  const phone = req.query.phone ? String(req.query.phone) : "";
  if (phone) {
    const row = await customerRepository.findByPhone(ctx, phone);
    return ok(res, row);
  }
  if (!ctx.isPlatform && !ctx.roles.includes("TENANT_OWNER") && !ctx.permissions.includes("customer.view")) {
    return fail(res, "FORBIDDEN", "Missing permission", 403);
  }
  const { rows, pagination } = await customerRepository.list(ctx, req.query as Record<string, unknown>);
  return okList(res, rows, pagination);
});

customersRouter.get("/search", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  if (!canLookupCustomers(ctx)) return fail(res, "FORBIDDEN", "Missing permission", 403);
  const rows = await customerRepository.search(ctx, {
    q: req.query.q ? String(req.query.q) : undefined,
    limit: req.query.limit,
  });
  return ok(res, rows);
});

customersRouter.get("/:id", requirePermission("customer.view"), async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  try {
    const row = await customerRepository.getById(ctx, String(req.params.id));
    const sales = await prisma.sale.findMany({
      where: { tenantId: tenantId(ctx), customerId: row.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { payments: true, branch: { select: { name: true } } },
    });
    const loyalty = await prisma.loyaltyTransaction.findMany({
      where: { tenantId: tenantId(ctx), customerId: row.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const payments = await prisma.ledgerPayment.findMany({
      where: { tenantId: tenantId(ctx), partyType: "CUSTOMER", partyId: row.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return ok(res, { ...row, sales, loyalty, payments });
  } catch (e) {
    if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
    throw e;
  }
});

customersRouter.post("/", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  if (!ctx.permissions.includes("customer.manage") && !ctx.permissions.includes("sale.create") && !ctx.isPlatform) {
    return fail(res, "FORBIDDEN", "Missing permission", 403);
  }
  const { name, phone, email, address, notes, taxId, creditLimit, type, createOnly } = req.body ?? {};
  if (!phone) return fail(res, "VALIDATION", "phone required");
  if (String(phone).replace(/\D/g, "").length < 10) return fail(res, "VALIDATION", "Enter a valid phone number");
  if (createOnly) {
    const existing = await customerRepository.findByPhone(ctx, String(phone));
    if (existing) return ok(res, { ...existing, alreadyExists: true });
  }
  const row = await customerRepository.upsertByPhone(ctx, { name, phone });
  const updated = await prisma.customer.update({
    where: { id: row.id },
    data: {
      email,
      address,
      notes,
      taxId,
      type: type || undefined,
      creditLimit: creditLimit != null ? String(creditLimit) : undefined,
    },
  });
  return ok(res, updated, undefined, 201);
});

customersRouter.patch("/:id", requirePermission("customer.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  try {
    const row = await customerRepository.getById(ctx, String(req.params.id));
    const b = req.body ?? {};
    const updated = await prisma.customer.update({
      where: { id: row.id },
      data: {
        name: b.name,
        email: b.email,
        ...(b.phone
          ? { phone: b.phone, phoneCanonical: normalizeBdPhone(b.phone) }
          : {}),
        address: b.address,
        notes: b.notes,
        taxId: b.taxId,
        type: b.type,
        status: b.status,
        creditLimit: b.creditLimit != null ? String(b.creditLimit) : undefined,
        birthday: b.birthday ? new Date(b.birthday) : undefined,
      },
    });
    return ok(res, updated);
  } catch (e) {
    if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
    throw e;
  }
});

customersRouter.delete("/:id", requirePermission("customer.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  try {
    const row = await customerRepository.getById(ctx, String(req.params.id));
    const sales = await prisma.sale.count({ where: { customerId: row.id } });
    if (sales > 0) return fail(res, "CONFLICT", "This customer has sales and cannot be deleted", 409);
    const orders = await prisma.salesOrder.count({ where: { customerId: row.id } });
    if (orders > 0) return fail(res, "CONFLICT", "This customer has orders and cannot be deleted", 409);
    await prisma.loyaltyTransaction.deleteMany({ where: { customerId: row.id } });
    await prisma.customer.delete({ where: { id: row.id } });
    await writeAudit({ ctx, action: "customer.delete", entityType: "Customer", entityId: row.id, before: { name: row.name } });
    return ok(res, { id: row.id });
  } catch (e) {
    if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
    throw e;
  }
});

customersRouter.post("/:id/loyalty", requirePermission("loyalty.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const { type, points, notes } = req.body ?? {};
  if (!type || points == null) return fail(res, "VALIDATION", "type and points required");
  const pts = Number(points);
  const customer = await customerRepository.getById(ctx, String(req.params.id));
  const delta = type === "REDEEM" ? -Math.abs(pts) : type === "ADJUST" ? pts : Math.abs(pts);
  const [txn] = await prisma.$transaction([
    prisma.loyaltyTransaction.create({
      data: {
        tenantId: tenantId(ctx),
        customerId: customer.id,
        type,
        points: delta,
        notes,
      },
    }),
    prisma.customer.update({
      where: { id: customer.id },
      data: { loyaltyPoints: { increment: delta } },
    }),
  ]);
  return ok(res, txn, undefined, 201);
});
