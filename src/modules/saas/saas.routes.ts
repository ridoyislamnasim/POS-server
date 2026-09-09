import { Router, type Request } from "express";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { tenantId } from "../../lib/erp.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";

export const saasRouter = Router();
saasRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

saasRouter.get("/plans", requirePermission("plan.manage"), async (_req, res) => {
  return ok(res, await prisma.plan.findMany({ orderBy: { price: "asc" } }));
});

saasRouter.get("/subscription", requirePermission("plan.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId(ctx) },
    include: { plan: true },
  });
  const usage = {
    branches: await prisma.branch.count({ where: { tenantId: tenantId(ctx) } }),
    users: await prisma.userTenant.count({ where: { tenantId: tenantId(ctx) } }),
    products: await prisma.product.count({ where: { tenantId: tenantId(ctx) } }),
    warehouses: await prisma.location.count({ where: { tenantId: tenantId(ctx), type: "WAREHOUSE" } }),
  };
  return ok(res, { tenant, usage, limits: tenant?.plan?.limits ?? {} });
});

saasRouter.post("/subscription", requirePermission("plan.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const plan = await prisma.plan.findFirst({ where: { id: String(req.body?.planId ?? ""), active: true } });
  if (!plan) return fail(res, "NOT_FOUND", "Plan not found", 404);
  const tenant = await prisma.tenant.update({
    where: { id: tenantId(ctx) },
    data: { planId: plan.id, subscriptionStatus: "ACTIVE" },
    include: { plan: true },
  });
  return ok(res, tenant);
});

saasRouter.get("/api-keys", requirePermission("integration.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.apiKey.findMany({
    where: { tenantId: tenantId(ctx) },
    orderBy: { createdAt: "desc" },
  });
  return ok(res, rows.map(({ keyHash: _, ...r }) => r));
});

saasRouter.post("/api-keys", requirePermission("integration.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const name = String(req.body?.name ?? "").trim();
  if (!name) return fail(res, "VALIDATION", "name required");
  const raw = `pos_${randomBytes(24).toString("hex")}`;
  const keyHash = createHash("sha256").update(raw).digest("hex");
  const row = await prisma.apiKey.create({
    data: {
      tenantId: tenantId(ctx),
      name,
      keyPrefix: raw.slice(0, 12),
      keyHash,
    },
  });
  const { keyHash: _, ...safe } = row;
  return ok(res, { ...safe, secret: raw }, undefined, 201);
});

saasRouter.post("/api-keys/:id/revoke", requirePermission("integration.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const existing = await prisma.apiKey.findFirst({
    where: { id: String(req.params.id), tenantId: tenantId(ctx) },
  });
  if (!existing) return fail(res, "NOT_FOUND", "Key not found", 404);
  const row = await prisma.apiKey.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
  const { keyHash: _, ...safe } = row;
  return ok(res, safe);
});

saasRouter.post("/backup", requirePermission("backup.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);
  const payload = {
    tenant: await prisma.tenant.findUnique({ where: { id: tid }, include: { businesses: true, settings: true, plan: true } }),
    branches: await prisma.branch.findMany({ where: { tenantId: tid } }),
    customers: await prisma.customer.findMany({ where: { tenantId: tid } }),
    suppliers: await prisma.supplier.findMany({ where: { tenantId: tid } }),
    products: await prisma.product.findMany({ where: { tenantId: tid }, include: { variants: true } }),
    exportedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(payload);
  const rec = await prisma.backupRecord.create({
    data: {
      tenantId: tid,
      status: "COMPLETE",
      note: req.body?.note ?? "manual",
      payloadSize: json.length,
      createdById: ctx.userId,
    },
  });
  await writeAudit({ ctx, action: "backup.create", entityType: "BackupRecord", entityId: rec.id });
  return ok(res, { record: rec, payload });
});

saasRouter.get("/backups", requirePermission("backup.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  return ok(res, await prisma.backupRecord.findMany({ where: { tenantId: tenantId(ctx) }, orderBy: { createdAt: "desc" }, take: 50 }));
});
