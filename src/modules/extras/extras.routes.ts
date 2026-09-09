import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { parseCsv, tenantId } from "../../lib/erp.js";
import { normalizeBdPhone } from "../../shared/phone.js";
import type { AuthedRequest } from "../../types.js";

export const extrasRouter = Router();
extrasRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

extrasRouter.get("/barcodes/generate", requirePermission("barcode.manage"), async (req, res) => {
  const sku = String(req.query.sku ?? "ITEM");
  const kind = String(req.query.kind ?? "CODE128");
  const count = Math.min(Number(req.query.count ?? 1), 50);
  const codes = Array.from({ length: count }, (_, i) => {
    const n = String(Date.now()).slice(-8) + String(i).padStart(2, "0");
    const code = kind === "EAN13" ? `890${n.padStart(9, "0").slice(0, 9)}` : `${sku}-${n}`;
    return { code, kind, sku, label: `${sku} ${code}` };
  });
  return ok(res, codes);
});

extrasRouter.post("/import/products", requirePermission("import.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const csv = String(req.body?.csv ?? "");
  if (!csv.trim()) return fail(res, "VALIDATION", "csv required");
  const { rows } = parseCsv(csv);
  const created: string[] = [];
  const errors: { line: number; error: string }[] = [];
  let line = 1;
  for (const row of rows) {
    line += 1;
    try {
      const name = row.name || row.product;
      const code = row.code || row.sku;
      if (!name || !code) throw new Error("name and code/sku required");
      const product = await prisma.product.upsert({
        where: { tenantId_code: { tenantId: tenantId(ctx), code } },
        create: { tenantId: tenantId(ctx), name, code, category: row.category || null },
        update: { name, category: row.category || undefined },
      });
      const sku = row.sku || `${code}-DEF`;
      await prisma.productVariant.upsert({
        where: { tenantId_sku: { tenantId: tenantId(ctx), sku } },
        create: {
          tenantId: tenantId(ctx),
          productId: product.id,
          sku,
          variantKey: "default",
          price: String(row.price || 0),
          cost: String(row.cost || 0),
        },
        update: { price: row.price ? String(row.price) : undefined, cost: row.cost ? String(row.cost) : undefined },
      });
      created.push(sku);
    } catch (e) {
      errors.push({ line, error: (e as Error).message });
    }
  }
  return ok(res, { created: created.length, errors });
});

extrasRouter.post("/import/customers", requirePermission("import.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const csv = String(req.body?.csv ?? "");
  if (!csv.trim()) return fail(res, "VALIDATION", "csv required");
  const { rows } = parseCsv(csv);
  let created = 0;
  const errors: { line: number; error: string }[] = [];
  let line = 1;
  for (const row of rows) {
    line += 1;
    try {
      const name = row.name;
      const phone = row.phone;
      if (!name || !phone) throw new Error("name and phone required");
      const phoneCanonical = normalizeBdPhone(phone);
      await prisma.customer.upsert({
        where: { tenantId_phoneCanonical: { tenantId: tenantId(ctx), phoneCanonical } },
        create: {
          tenantId: tenantId(ctx),
          name,
          phone,
          phoneCanonical,
          email: row.email || null,
          address: row.address || null,
        },
        update: { name, email: row.email || undefined, address: row.address || undefined },
      });
      created += 1;
    } catch (e) {
      errors.push({ line, error: (e as Error).message });
    }
  }
  return ok(res, { created, errors });
});

extrasRouter.post("/notifications", requirePermission("notification.send"), async (req, res) => {
  const ctx = ctxOf(req);
  const { channel, to, template, payload } = req.body ?? {};
  if (!channel || !to || !template) return fail(res, "VALIDATION", "channel, to, template required");
  const row = await prisma.notificationLog.create({
    data: {
      tenantId: tenantId(ctx),
      channel,
      to: String(to),
      template,
      payload: payload ?? {},
      status: "QUEUED",
    },
  });
  const updated = await prisma.notificationLog.update({
    where: { id: row.id },
    data: { status: "SENT" },
  });
  return ok(res, updated, undefined, 201);
});

extrasRouter.get("/notifications", requirePermission("notification.send"), async (req, res) => {
  const ctx = ctxOf(req);
  const rows = await prisma.notificationLog.findMany({
    where: { tenantId: tenantId(ctx) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return ok(res, rows);
});

extrasRouter.post("/notifications/low-stock", requirePermission("notification.send"), async (req, res) => {
  const ctx = ctxOf(req);
  const settings = await prisma.tenantSettings.findUnique({ where: { tenantId: tenantId(ctx) } });
  const threshold = settings?.lowStockThreshold ?? 5;
  const stock = await prisma.stock.findMany({
    where: { tenantId: tenantId(ctx) },
    include: { variant: { include: { product: true } } },
  });
  const low = stock.filter((s) => Number(s.quantity) - Number(s.reservedQuantity ?? 0) <= threshold);
  const logs = [];
  for (const s of low.slice(0, 25)) {
    logs.push(
      await prisma.notificationLog.create({
        data: {
          tenantId: tenantId(ctx),
          channel: "IN_APP",
          to: "ops",
          template: "LOW_STOCK",
          payload: { sku: s.variant.sku, product: s.variant.product.name, qty: String(s.quantity) },
          status: "SENT",
        },
      }),
    );
  }
  return ok(res, { threshold, count: low.length, queued: logs.length, items: logs });
});

extrasRouter.get("/export", requirePermission("import.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const kind = String(req.query.kind ?? "customers");
  if (kind === "products") {
    const products = await prisma.product.findMany({
      where: { tenantId: tenantId(ctx) },
      include: { variants: true },
    });
    return ok(res, products);
  }
  const customers = await prisma.customer.findMany({ where: { tenantId: tenantId(ctx) } });
  return ok(res, customers);
});
