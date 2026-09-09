import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { planLimits, tenantId } from "../../lib/erp.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";

export const orgRouter = Router();
orgRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

orgRouter.get("/business", requirePermission("tenant.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const row = await prisma.business.findFirst({ where: { tenantId: tenantId(ctx) } });
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId(ctx) }, include: { plan: true, settings: true } });
  return ok(res, { business: row, tenant });
});

orgRouter.patch("/business", requirePermission("tenant.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);
  const existing = await prisma.business.findFirst({ where: { tenantId: tid } });
  const data = {
    name: req.body?.name,
    legalName: req.body?.legalName,
    vatId: req.body?.vatId,
    address: req.body?.address,
    phone: req.body?.phone,
    email: req.body?.email,
    logoUrl: req.body?.logoUrl,
    currency: req.body?.currency,
  };
  const row = existing
    ? await prisma.business.update({ where: { id: existing.id }, data })
    : await prisma.business.create({ data: { tenantId: tid, ...data, name: data.name ?? "Business" } });
  if (req.body?.tenantName) {
    await prisma.tenant.update({ where: { id: tid }, data: { name: String(req.body.tenantName) } });
  }
  await writeAudit({ ctx, action: "business.update", entityType: "Business", entityId: row.id });
  return ok(res, row);
});

orgRouter.get("/branches", requirePermission("branch.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.branch.findMany({
    where: { tenantId: tenantId(ctx) },
    include: { location: true, registers: { include: { devices: true } }, _count: { select: { userBranches: true, sales: true } } },
    orderBy: { name: "asc" },
  });
  return ok(res, rows);
});

orgRouter.post("/branches", requirePermission("branch.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { name, code, type, timezone, negativeStockPolicy } = req.body ?? {};
  if (!name || !code) return fail(res, "VALIDATION", "name and code required");
  const { limits } = await planLimits(ctx);
  const count = await prisma.branch.count({ where: { tenantId: tenantId(ctx) } });
  if (limits.maxBranches && count >= limits.maxBranches) {
    return fail(res, "PLAN_LIMIT", `Plan allows ${limits.maxBranches} branches`, 402);
  }
  const loc = await prisma.location.create({
    data: { tenantId: tenantId(ctx), type: type === "WAREHOUSE" ? "WAREHOUSE" : "STORE", name: `${name} Floor` },
  });
  await prisma.stockLocationChannel.create({
    data: { tenantId: tenantId(ctx), locationId: loc.id, channel: "STORE" },
  });
  const branch = await prisma.branch.create({
    data: {
      tenantId: tenantId(ctx),
      locationId: loc.id,
      name,
      code: String(code).toUpperCase(),
      timezone: timezone ?? "Asia/Dhaka",
      negativeStockPolicy: negativeStockPolicy ?? "BLOCK",
    },
  });
  await prisma.register.create({ data: { tenantId: tenantId(ctx), branchId: branch.id, name: "Register 01" } });
  const year = new Date().getFullYear();
  await prisma.documentNumberSequence.create({
    data: {
      tenantId: tenantId(ctx),
      branchId: branch.id,
      documentType: "INVOICE",
      fiscalYear: year,
      prefix: `${branch.code}-INV-${year}-`,
    },
  });
  return ok(res, branch, undefined, 201);
});

orgRouter.patch("/branches/:id", requirePermission("branch.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.branch.findFirst({ where: { id: String(req.params.id), tenantId: tenantId(ctx) } });
  if (!existing) return fail(res, "NOT_FOUND", "Branch not found", 404);
  const row = await prisma.branch.update({
    where: { id: existing.id },
    data: {
      name: req.body?.name,
      operationalStatus: req.body?.operationalStatus,
      timezone: req.body?.timezone,
      negativeStockPolicy: req.body?.negativeStockPolicy,
    },
  });
  return ok(res, row);
});

orgRouter.delete("/branches/:id", requirePermission("branch.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.branch.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
    include: { _count: { select: { sales: true, userBranches: true } } },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Branch not found", 404);
  if (existing._count.sales > 0) return fail(res, "CONFLICT", "This branch has sales and cannot be deleted", 409);
  if (existing._count.userBranches > 0) {
    return fail(res, "CONFLICT", "Remove assigned users from this branch first", 409);
  }
  const registers = await prisma.register.findMany({ where: { branchId: existing.id }, select: { id: true } });
  const registerIds = registers.map((r) => r.id);
  const shifts = registerIds.length
    ? await prisma.shift.count({ where: { registerId: { in: registerIds } } })
    : 0;
  if (shifts > 0) return fail(res, "CONFLICT", "This branch has shift history and cannot be deleted", 409);
  if (registerIds.length) {
    await prisma.tillDevice.deleteMany({ where: { registerId: { in: registerIds } } });
  }
  await prisma.documentNumberSequence.deleteMany({ where: { branchId: existing.id } });
  await prisma.register.deleteMany({ where: { branchId: existing.id } });
  await prisma.branch.delete({ where: { id: existing.id } });
  await writeAudit({ ctx, action: "branch.delete", entityType: "Branch", entityId: existing.id, before: { name: existing.name } });
  return ok(res, { id: existing.id });
});

orgRouter.get("/warehouses", requirePermission("warehouse.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.location.findMany({
    where: { tenantId: tenantId(ctx), type: "WAREHOUSE" },
    include: { _count: { select: { stock: true } } },
    orderBy: { name: "asc" },
  });
  return ok(res, rows);
});

orgRouter.post("/warehouses", requirePermission("warehouse.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const { name } = req.body ?? {};
  if (!name) return fail(res, "VALIDATION", "name required");
  const { limits } = await planLimits(ctx);
  const count = await prisma.location.count({ where: { tenantId: tenantId(ctx), type: "WAREHOUSE" } });
  if (limits.maxWarehouses && count >= limits.maxWarehouses) {
    return fail(res, "PLAN_LIMIT", `Plan allows ${limits.maxWarehouses} warehouses`, 402);
  }
  const loc = await prisma.location.create({
    data: { tenantId: tenantId(ctx), type: "WAREHOUSE", name },
  });
  await prisma.stockLocationChannel.create({
    data: { tenantId: tenantId(ctx), locationId: loc.id, channel: "WAREHOUSE" },
  });
  return ok(res, loc, undefined, 201);
});

orgRouter.delete("/warehouses/:id", requirePermission("warehouse.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.location.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx), type: "WAREHOUSE" },
    include: { _count: { select: { stock: true } } },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Warehouse not found", 404);
  if (existing._count.stock > 0) return fail(res, "CONFLICT", "This warehouse still has stock", 409);
  await prisma.stockLocationChannel.deleteMany({ where: { locationId: existing.id } });
  await prisma.location.delete({ where: { id: existing.id } });
  await writeAudit({ ctx, action: "warehouse.delete", entityType: "Location", entityId: existing.id, before: { name: existing.name } });
  return ok(res, { id: existing.id });
});
