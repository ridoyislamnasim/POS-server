import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { ForbiddenError, InsufficientStockError, assertBranch } from "../../lib/scope.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";
import { createSale } from "./sales.service.js";
import { saleRepository } from "./sale.repository.js";
import { createSaleReturn, decideSaleReturn, listReturns, voidSale } from "./returns.service.js";

export const salesRouter = Router();
salesRouter.use(requireAuth, requireTenant);

const createSchema = z.object({
  branchId: z.string(),
  registerId: z.string(),
  deviceId: z.string(),
  deviceSequence: z.number().optional(),
  clientTransactionId: z.string(),
  customerId: z.string().optional(),
  channel: z.enum(["STORE", "ONLINE", "MARKETPLACE"]).optional(),
  transactionDiscount: z.string().optional(),
  items: z
    .array(
      z.object({
        variantId: z.string(),
        qty: z.number().positive(),
        discountAmount: z.string().optional(),
        discountReason: z.string().optional(),
        associateId: z.string().optional(),
      }),
    )
    .min(1),
  payments: z
    .array(
      z.object({
        method: z.string(),
        amount: z.string(),
        status: z
          .enum(["PENDING", "AUTHORIZED", "CAPTURED", "FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED"])
          .optional(),
      }),
    )
    .min(1),
});

salesRouter.post("/", requirePermission("sale.create"), async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, "VALIDATION", parsed.error.message);
  const ctx = (req as AuthedRequest).ctx;
  try {
    const result = await createSale({
      ctx,
      correlationId: (req as AuthedRequest).correlationId,
      idempotencyKey: (req.headers["idempotency-key"] as string | undefined) ?? undefined,
      ...parsed.data,
    });
    return ok(res, result.body, { replay: result.replay }, result.replay ? 200 : 201);
  } catch (e) {
    const err = e as Error & { code?: string };
    const status =
      err.code === "INSUFFICIENT_STOCK"
        ? 409
        : err instanceof ForbiddenError || err.code === "FORBIDDEN"
          ? 403
          : err instanceof InsufficientStockError
            ? 409
            : 400;
    return fail(res, err.code ?? "VALIDATION", err.message, status);
  }
});

salesRouter.get("/holds/open", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const rows = await prisma.heldSale.findMany({
    where: {
      tenantId: ctx.tenantId!,
      cashierId: ctx.userId,
      ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
    },
    orderBy: { createdAt: "desc" },
  });
  return ok(res, rows);
});

salesRouter.get("/", requirePermission("sale.view"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const { rows, meta } = await saleRepository.list(ctx, req.query);
  return ok(res, rows, meta);
});

salesRouter.get("/returns", requirePermission("sale.view"), async (req, res) => {
  const rows = await listReturns((req as AuthedRequest).ctx);
  return ok(res, rows);
});

salesRouter.post("/returns/:id/approve", requirePermission("refund.approve"), async (req, res) => {
  try {
    const row = await decideSaleReturn({ ctx: (req as unknown as AuthedRequest).ctx, id: String(req.params.id), approve: true });
    return ok(res, row);
  } catch (e) {
    const err = e as Error & { code?: string };
    const status = err instanceof ForbiddenError || err.code === "FORBIDDEN" ? 403 : 400;
    return fail(res, err.code ?? "VALIDATION", err.message, status);
  }
});

salesRouter.post("/returns/:id/reject", requirePermission("refund.approve"), async (req, res) => {
  try {
    const row = await decideSaleReturn({ ctx: (req as unknown as AuthedRequest).ctx, id: String(req.params.id), approve: false });
    return ok(res, row);
  } catch (e) {
    const err = e as Error & { code?: string };
    const status = err instanceof ForbiddenError || err.code === "FORBIDDEN" ? 403 : 400;
    return fail(res, err.code ?? "VALIDATION", err.message, status);
  }
});

salesRouter.get("/:id", requirePermission("sale.view"), async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  try {
    const sale = await saleRepository.getById(ctx, String(req.params.id));
    return ok(res, sale);
  } catch (e) {
    if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
    throw e;
  }
});

const returnSchema = z.object({
  kind: z.enum(["RETURN", "EXCHANGE"]).default("RETURN"),
  reason: z.string().min(1),
  notes: z.string().optional(),
  refundMethod: z.enum(["CASH", "CARD", "MFS", "STORE_CREDIT"]).optional(),
  restock: z.boolean().optional(),
  items: z
    .array(
      z.object({
        saleItemId: z.string(),
        qty: z.number().positive(),
        restock: z.boolean().optional(),
        reason: z.string().optional(),
      }),
    )
    .min(1),
  exchangeItems: z
    .array(z.object({ variantId: z.string(), qty: z.number().positive() }))
    .optional(),
});

salesRouter.post("/:id/returns", requirePermission("sale.return"), async (req, res) => {
  const parsed = returnSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, "VALIDATION", parsed.error.message);
  try {
    const row = await createSaleReturn({
      ctx: (req as unknown as AuthedRequest).ctx,
      saleId: String(req.params.id),
      ...parsed.data,
    });
    return ok(res, row, undefined, 201);
  } catch (e) {
    const err = e as Error & { code?: string };
    const status =
      err.code === "INSUFFICIENT_STOCK" || err instanceof InsufficientStockError
        ? 409
        : err instanceof ForbiddenError || err.code === "FORBIDDEN"
          ? 403
          : 400;
    return fail(res, err.code ?? "VALIDATION", err.message, status);
  }
});

salesRouter.post("/:id/void", requirePermission("sale.void"), async (req, res) => {
  const reason = String(req.body?.reason ?? "").trim();
  if (!reason) return fail(res, "VALIDATION", "reason required");
  try {
    const row = await voidSale({ ctx: (req as unknown as AuthedRequest).ctx, saleId: String(req.params.id), reason });
    return ok(res, row);
  } catch (e) {
    const err = e as Error & { code?: string };
    const status = err instanceof ForbiddenError || err.code === "FORBIDDEN" ? 403 : 400;
    return fail(res, err.code ?? "VALIDATION", err.message, status);
  }
});

salesRouter.post("/hold", requirePermission("sale.create"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const branchId = String(req.body.branchId ?? "");
  try {
    assertBranch(ctx, branchId);
  } catch (e) {
    if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
    throw e;
  }
  const row = await prisma.heldSale.create({
    data: {
      tenantId: ctx.tenantId!,
      branchId,
      cashierId: ctx.userId,
      payload: req.body.payload ?? req.body,
    },
  });
  await writeAudit({
    ctx,
    action: "sale.create",
    entityType: "HeldSale",
    entityId: row.id,
    after: { hold: true },
    correlationId: (req as AuthedRequest).correlationId,
  });
  return ok(res, row, undefined, 201);
});

salesRouter.delete("/holds/:id", async (req, res) => {
  const ctx = (req as unknown as AuthedRequest).ctx;
  const existing = await prisma.heldSale.findFirst({ where: { id: String(req.params.id) } });
  if (!existing || existing.tenantId !== ctx.tenantId || existing.cashierId !== ctx.userId) {
    return fail(res, "FORBIDDEN", "Forbidden", 403);
  }
  await prisma.heldSale.delete({ where: { id: existing.id } });
  return ok(res, { deleted: true });
});
