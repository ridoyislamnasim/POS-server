import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { IndustryPackRegistry } from "../../packs/registry.js";
import { buildVariantKey } from "../../shared/variant-key.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";

export const catalogRouter = Router();
catalogRouter.use(requireAuth, requireTenant);

const productInclude = {
  taxCategory: true,
  variants: {
    include: {
      attributes: { include: { option: { include: { definition: true } } } },
      barcodes: { where: { active: true } },
      stock: true,
    },
  },
} as const;

catalogRouter.get("/attributes", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const rows = await prisma.attributeDefinition.findMany({
    where: { tenantId: ctx.tenantId! },
    include: { options: { orderBy: { sortOrder: "asc" } } },
    orderBy: { sortOrder: "asc" },
  });
  return ok(res, rows);
});

catalogRouter.get("/tax-categories", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  return ok(res, await prisma.taxCategory.findMany({ where: { tenantId: ctx.tenantId! } }));
});

catalogRouter.get("/products", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const q = String(req.query.q ?? "").trim();
  const status = String(req.query.status ?? "ACTIVE").toUpperCase();
  const products = await prisma.product.findMany({
    where: {
      tenantId: ctx.tenantId!,
      ...(status === "ALL" ? {} : { status: status as "ACTIVE" | "ARCHIVED" | "DRAFT" | "INACTIVE" | "DISCONTINUED" }),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { code: { contains: q, mode: "insensitive" } },
              { variants: { some: { sku: { contains: q, mode: "insensitive" } } } },
              { variants: { some: { barcodes: { some: { code: q, active: true } } } } },
            ],
          }
        : {}),
    },
    include: {
      taxCategory: true,
      variants: {
        where: { status: "ACTIVE" },
        include: {
          attributes: { include: { option: { include: { definition: true } } } },
          barcodes: { where: { active: true } },
          stock: { where: { tenantId: ctx.tenantId! } },
        },
      },
    },
    take: 100,
  });
  return ok(res, products);
});

catalogRouter.get("/barcode/:code", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const barcode = await prisma.barcode.findFirst({
    where: { tenantId: ctx.tenantId!, code: String(req.params.code), active: true },
    include: {
      variant: {
        include: {
          product: { include: { taxCategory: true } },
          attributes: { include: { option: { include: { definition: true } } } },
          stock: true,
        },
      },
    },
  });
  if (!barcode) return fail(res, "NOT_FOUND", "Barcode not found", 404);
  return ok(res, barcode);
});

catalogRouter.get("/products/:id/matrix", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const product = await prisma.product.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
    include: {
      taxCategory: true,
      variants: {
        include: {
          attributes: { include: { option: { include: { definition: true } } } },
          barcodes: { where: { active: true } },
          stock: true,
        },
      },
    },
  });
  if (!product) return fail(res, "NOT_FOUND", "Product not found", 404);

  const tenant = await prisma.tenant.findFirst({ where: { id: ctx.tenantId! } });
  const axes = IndustryPackRegistry.matrixAxes(tenant?.industryPack ?? "FASHION");
  const colours = new Map<string, string>();
  const sizes = new Map<string, string>();
  const cells: Record<string, (typeof product.variants)[0]> = {};
  for (const v of product.variants) {
    const colour = v.attributes.find((a) => a.option.definition.key === axes.row);
    const size = v.attributes.find((a) => a.option.definition.key === axes.col);
    if (colour) colours.set(colour.option.value, colour.option.label);
    if (size) sizes.set(size.option.value, size.option.label);
    if (colour && size) cells[`${colour.option.value}|${size.option.value}`] = v;
  }
  return ok(res, {
    product,
    colours: [...colours.entries()].map(([value, label]) => ({ value, label })),
    sizes: [...sizes.entries()].map(([value, label]) => ({ value, label })),
    cells,
  });
});

catalogRouter.get("/products/:id", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const product = await prisma.product.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
    include: productInclude,
  });
  if (!product) return fail(res, "NOT_FOUND", "Product not found", 404);
  return ok(res, product);
});

catalogRouter.post("/products", requirePermission("catalog.manage"), async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const { name, code, category, taxCategoryId, type } = req.body ?? {};
  if (!name || !code) return fail(res, "VALIDATION", "name and code required");
  try {
    const product = await prisma.product.create({
      data: {
        tenantId: ctx.tenantId!,
        name,
        code: String(code).toUpperCase(),
        category: category || null,
        taxCategoryId: taxCategoryId || null,
        type: type ?? "PHYSICAL",
        status: "ACTIVE",
      },
      include: productInclude,
    });
    await writeAudit({
      ctx,
      action: "catalog.create",
      entityType: "Product",
      entityId: product.id,
      after: { name, code },
      correlationId: (req as unknown as AuthedRequest).correlationId,
    });
    return ok(res, product, undefined, 201);
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === "P2002") return fail(res, "CONFLICT", "Product code already exists", 409);
    return fail(res, "VALIDATION", (e as Error).message);
  }
});

catalogRouter.patch("/products/:id", requirePermission("catalog.manage"), async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.product.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Product not found", 404);
  const { name, code, category, taxCategoryId, status } = req.body ?? {};
  const product = await prisma.product.update({
    where: { id: existing.id },
    data: {
      ...(name ? { name } : {}),
      ...(code ? { code: String(code).toUpperCase() } : {}),
      ...(category !== undefined ? { category } : {}),
      ...(taxCategoryId !== undefined ? { taxCategoryId } : {}),
      ...(status ? { status } : {}),
    },
    include: productInclude,
  });
  return ok(res, product);
});

catalogRouter.post("/products/:id/archive", requirePermission("catalog.manage"), async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.product.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Product not found", 404);
  const product = await prisma.product.update({
    where: { id: existing.id },
    data: { status: "ARCHIVED" },
    include: productInclude,
  });
  await writeAudit({
    ctx,
    action: "catalog.archive",
    entityType: "Product",
    entityId: product.id,
    correlationId: (req as unknown as AuthedRequest).correlationId,
  });
  return ok(res, product);
});

catalogRouter.post("/products/:id/generate-variants", requirePermission("catalog.manage"), async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const product = await prisma.product.findFirst({
    where: { id: String(req.params.id), tenantId: ctx.tenantId! },
  });
  if (!product) return fail(res, "NOT_FOUND", "Product not found", 404);
  const { colourOptionIds, sizeOptionIds, price, cost, openingStock } = req.body ?? {};
  if (!Array.isArray(colourOptionIds) || !Array.isArray(sizeOptionIds) || !colourOptionIds.length || !sizeOptionIds.length) {
    return fail(res, "VALIDATION", "colourOptionIds and sizeOptionIds required");
  }
  const options = await prisma.attributeOption.findMany({
    where: { id: { in: [...colourOptionIds, ...sizeOptionIds] } },
    include: { definition: true },
  });
  const byId = new Map(options.map((o) => [o.id, o]));
  const created = [];
  for (const colourId of colourOptionIds as string[]) {
    for (const sizeId of sizeOptionIds as string[]) {
      const colour = byId.get(colourId);
      const size = byId.get(sizeId);
      if (!colour || !size) continue;
      const variantKey = buildVariantKey([
        { key: colour.definition.key, value: colour.value },
        { key: size.definition.key, value: size.value },
      ]);
      const sku = `${product.code}-${colour.value}-${size.value}`.toUpperCase();
      const existing = await prisma.productVariant.findFirst({
        where: { productId: product.id, variantKey },
      });
      if (existing) {
        created.push(existing);
        continue;
      }
      const variant = await prisma.productVariant.create({
        data: {
          tenantId: ctx.tenantId!,
          productId: product.id,
          sku,
          variantKey,
          price: String(price ?? 0),
          cost: String(cost ?? 0),
          attributes: { create: [{ optionId: colour.id }, { optionId: size.id }] },
          barcodes: {
            create: {
              tenantId: ctx.tenantId!,
              code: `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 1000000).toString().padStart(6, "0")}`,
              kind: "CODE128",
              primary: true,
            },
          },
        },
      });
      if (Array.isArray(openingStock)) {
        for (const row of openingStock as { locationId: string; quantity: string | number }[]) {
          if (!row.locationId) continue;
          const qty = Number(row.quantity ?? 0);
          await prisma.stock.upsert({
            where: {
              tenantId_locationId_channel_variantId: {
                tenantId: ctx.tenantId!,
                locationId: row.locationId,
                channel: "STORE",
                variantId: variant.id,
              },
            },
            create: {
              tenantId: ctx.tenantId!,
              locationId: row.locationId,
              variantId: variant.id,
              quantity: String(qty),
            },
            update: {},
          });
          if (qty > 0) {
            await prisma.stockMovement.create({
              data: {
                tenantId: ctx.tenantId!,
                locationId: row.locationId,
                variantId: variant.id,
                type: "OPENING",
                quantity: String(qty),
                createdById: ctx.userId,
                reason: "Opening stock",
              },
            });
          }
        }
      }
      created.push(variant);
    }
  }
  const full = await prisma.product.findFirst({
    where: { id: product.id },
    include: productInclude,
  });
  return ok(res, { product: full, created: created.length });
});

catalogRouter.patch("/variants/:id", requirePermission("catalog.manage"), async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.productVariant.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Variant not found", 404);
  const { sku, price, cost, status } = req.body ?? {};
  const variant = await prisma.productVariant.update({
    where: { id: existing.id },
    data: {
      ...(sku ? { sku: String(sku).toUpperCase() } : {}),
      ...(price !== undefined ? { price: String(price) } : {}),
      ...(cost !== undefined ? { cost: String(cost) } : {}),
      ...(status ? { status } : {}),
    },
    include: { barcodes: true, stock: true, attributes: { include: { option: { include: { definition: true } } } } },
  });
  return ok(res, variant);
});

catalogRouter.post("/variants/:id/barcodes", requirePermission("catalog.manage"), async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.productVariant.findFirst({ where: { id: String(req.params.id), tenantId: ctx.tenantId! } });
  if (!existing) return fail(res, "NOT_FOUND", "Variant not found", 404);
  const { code, kind, primary } = req.body ?? {};
  if (!code) return fail(res, "VALIDATION", "code required");
  if (primary) {
    await prisma.barcode.updateMany({ where: { variantId: existing.id, tenantId: ctx.tenantId! }, data: { primary: false } });
  }
  try {
    const row = await prisma.barcode.create({
      data: {
        tenantId: ctx.tenantId!,
        variantId: existing.id,
        code: String(code),
        kind: kind ?? "CODE128",
        primary: Boolean(primary),
      },
    });
    return ok(res, row, undefined, 201);
  } catch {
    return fail(res, "CONFLICT", "Barcode already in use", 409);
  }
});

