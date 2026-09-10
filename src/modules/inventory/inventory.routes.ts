import { Router } from "express";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { ForbiddenError, InsufficientStockError, assertBranch } from "../../lib/scope.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";
import { stockRepository } from "./stock.repository.js";
import { listLedger, stockSummary } from "./ledger.service.js";
import {
  cancelReceipt,
  createReceipt,
  getReceipt,
  listReceipts,
  receiveReceipt,
  receiptsSummary,
} from "./receipts.service.js";
import {
  createDamage,
  decideDamage,
  damagesSummary,
  getDamage,
  listDamages,
  submitDamage,
} from "./damage.service.js";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth, requireTenant, requirePermission("inventory.view"));

function handleErr(res: Parameters<typeof fail>[0], e: unknown) {
  if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
  if (e instanceof InsufficientStockError) return fail(res, "INSUFFICIENT_STOCK", e.message, 409);
  const err = e as Error & { code?: string };
  const status =
    err.code === "NOT_FOUND" ? 404 : err.code === "CONFLICT" || err.code === "INSUFFICIENT_STOCK" ? 409 : err.code === "FORBIDDEN" ? 403 : 400;
  return fail(res, err.code ?? "VALIDATION", err.message, status);
}

inventoryRouter.get("/", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  try {
    const { rows, pagination } = await stockRepository.list(ctx, req.query as Record<string, unknown>);
    return okList(res, rows, pagination);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/locations", async (req, res) => {
  return ok(res, await stockRepository.listLocations((req as AuthedRequest).ctx));
});

inventoryRouter.get("/stock", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const locationId = String(req.query.locationId ?? "");
  if (!locationId) return fail(res, "VALIDATION", "locationId required");
  try {
    const rows = await stockRepository.listByLocation(ctx, locationId);
    return ok(res, rows);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/movements", requirePermission("inventory.ledger.view"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  try {
    const { rows, pagination } = await stockRepository.listMovements(ctx, req.query as Record<string, unknown>);
    return okList(res, rows, pagination);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/adjust", requirePermission("inventory.adjust"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const { variantId, locationId, direction, quantity, reason, notes } = req.body ?? {};
  if (!variantId || !locationId || !direction || !quantity || !reason) {
    return fail(res, "VALIDATION", "variantId, locationId, direction, quantity, reason required");
  }
  try {
    const result = await stockRepository.adjust(ctx, {
      variantId,
      locationId,
      direction,
      quantity: Number(quantity),
      reason,
      notes,
    });
    await writeAudit({
      ctx,
      action: "inventory.adjust",
      entityType: "StockMovement",
      entityId: result.movement.id,
      after: { direction, quantity, reason },
      correlationId: (req as AuthedRequest).correlationId,
    });
    return ok(res, result, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/transfer", requirePermission("inventory.transfer"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const { variantId, fromLocationId, toLocationId, quantity, notes } = req.body ?? {};
  if (!variantId || !fromLocationId || !toLocationId || !quantity) {
    return fail(res, "VALIDATION", "variantId, fromLocationId, toLocationId, quantity required");
  }
  try {
    const result = await stockRepository.transfer(ctx, {
      variantId,
      fromLocationId,
      toLocationId,
      quantity: Number(quantity),
      notes,
    });
    await writeAudit({
      ctx,
      action: "inventory.transfer",
      entityType: "StockMovement",
      entityId: result.out.id,
      after: { fromLocationId, toLocationId, quantity },
      correlationId: (req as AuthedRequest).correlationId,
    });
    return ok(res, result, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/stock-takes", requirePermission("inventory.adjust"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const { branchId, locationId, notes, lines } = req.body ?? {};
  if (!branchId || !locationId || !Array.isArray(lines) || !lines.length) {
    return fail(res, "VALIDATION", "branchId, locationId, lines required");
  }
  try {
    assertBranch(ctx, branchId);
    const result = await stockRepository.postStockTake(ctx, {
      branchId,
      locationId,
      notes,
      lines: lines.map((l: { variantId: string; countedQty: number }) => ({
        variantId: l.variantId,
        countedQty: Number(l.countedQty),
      })),
    });
    await writeAudit({
      ctx,
      action: "inventory.adjust",
      entityType: "StockTake",
      entityId: result.id,
      after: { lines: lines.length },
      correlationId: (req as AuthedRequest).correlationId,
    });
    return ok(res, result, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/stock-takes", async (req, res) => {
  try {
    return ok(res, await stockRepository.listStockTakes((req as AuthedRequest).ctx));
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/reserve", requirePermission("inventory.reserve"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const { variantId, locationId, quantity, release } = req.body ?? {};
  if (!variantId || !locationId || !quantity) {
    return fail(res, "VALIDATION", "variantId, locationId, quantity required");
  }
  try {
    const stock = await stockRepository.reserve(ctx, {
      variantId,
      locationId,
      quantity: Number(quantity),
      release: Boolean(release),
    });
    await writeAudit({
      ctx,
      action: release ? "inventory.release" : "inventory.reserve",
      entityType: "Stock",
      entityId: stock.id,
      after: { quantity, release: Boolean(release) },
      correlationId: (req as AuthedRequest).correlationId,
    });
    return ok(res, stock);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/receipts", requirePermission("inventory.receive.view"), async (req, res) => {
  try {
    const { rows, pagination } = await listReceipts((req as AuthedRequest).ctx, req.query as Record<string, unknown>);
    return okList(res, rows, pagination);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/receipts/summary", requirePermission("inventory.receive.view"), async (req, res) => {
  try {
    return ok(
      res,
      await receiptsSummary((req as AuthedRequest).ctx, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      }),
    );
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/receipts/:id", requirePermission("inventory.receive.view"), async (req, res) => {
  try {
    return ok(res, await getReceipt((req as unknown as AuthedRequest).ctx, String(req.params.id)));
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/receipts", requirePermission("inventory.receive.create"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const body = req.body ?? {};
  try {
    const row = await createReceipt({
      ctx,
      branchId: String(body.branchId ?? ""),
      locationId: body.locationId,
      kind: body.kind,
      supplierId: body.supplierId,
      purchaseId: body.purchaseId,
      purchaseOrderId: body.purchaseOrderId,
      fromLocationId: body.fromLocationId,
      notes: body.notes,
      items: Array.isArray(body.items) ? body.items : [],
      post: Boolean(body.post),
      idempotencyKey: (req.headers["idempotency-key"] as string | undefined) ?? body.idempotencyKey,
    });
    await writeAudit({
      ctx,
      action: "inventory.receive.create",
      entityType: "StockReceipt",
      entityId: (row as { id?: string }).id ?? "",
      after: { kind: body.kind, post: Boolean(body.post) },
      correlationId: (req as AuthedRequest).correlationId,
    });
    return ok(res, row, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/receipts/:id/receive", requirePermission("inventory.receive.approve"), async (req, res) => {
  try {
    const row = await receiveReceipt({
      ctx: (req as unknown as AuthedRequest).ctx,
      id: String(req.params.id),
      idempotencyKey: req.headers["idempotency-key"] as string | undefined,
    });
    return ok(res, row);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/receipts/:id/cancel", requirePermission("inventory.receive.approve"), async (req, res) => {
  try {
    const row = await cancelReceipt({
      ctx: (req as unknown as AuthedRequest).ctx,
      id: String(req.params.id),
      reason: req.body?.reason,
    });
    return ok(res, row);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/damages", requirePermission("inventory.damage.view"), async (req, res) => {
  try {
    const { rows, pagination } = await listDamages((req as AuthedRequest).ctx, req.query as Record<string, unknown>);
    return okList(res, rows, pagination);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/damages/summary", requirePermission("inventory.damage.view"), async (req, res) => {
  try {
    return ok(
      res,
      await damagesSummary((req as AuthedRequest).ctx, {
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      }),
    );
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/damages/:id", requirePermission("inventory.damage.view"), async (req, res) => {
  try {
    return ok(res, await getDamage((req as unknown as AuthedRequest).ctx, String(req.params.id)));
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/damages", requirePermission("inventory.damage.create"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const body = req.body ?? {};
  try {
    const row = await createDamage({
      ctx,
      branchId: String(body.branchId ?? ""),
      locationId: body.locationId,
      reason: body.reason,
      description: body.description,
      attachmentDataUrl: body.attachmentDataUrl,
      items: Array.isArray(body.items) ? body.items : [],
      submit: Boolean(body.submit),
      idempotencyKey: (req.headers["idempotency-key"] as string | undefined) ?? body.idempotencyKey,
    });
    await writeAudit({
      ctx,
      action: "inventory.damage.create",
      entityType: "StockDamage",
      entityId: (row as { id?: string }).id ?? "",
      after: { reason: body.reason },
      correlationId: (req as AuthedRequest).correlationId,
    });
    return ok(res, row, undefined, 201);
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/damages/:id/submit", requirePermission("inventory.damage.create"), async (req, res) => {
  try {
    return ok(res, await submitDamage({ ctx: (req as unknown as AuthedRequest).ctx, id: String(req.params.id) }));
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/damages/:id/approve", requirePermission("inventory.damage.approve"), async (req, res) => {
  try {
    return ok(
      res,
      await decideDamage({
        ctx: (req as unknown as AuthedRequest).ctx,
        id: String(req.params.id),
        approve: true,
        idempotencyKey: req.headers["idempotency-key"] as string | undefined,
      }),
    );
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.post("/damages/:id/reject", requirePermission("inventory.damage.approve"), async (req, res) => {
  try {
    return ok(
      res,
      await decideDamage({
        ctx: (req as unknown as AuthedRequest).ctx,
        id: String(req.params.id),
        approve: false,
        rejectReason: req.body?.reason,
        idempotencyKey: req.headers["idempotency-key"] as string | undefined,
      }),
    );
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/summary", async (req, res) => {
  try {
    return ok(res, await stockSummary((req as AuthedRequest).ctx, req.query.locationId ? String(req.query.locationId) : undefined));
  } catch (e) {
    return handleErr(res, e);
  }
});

inventoryRouter.get("/:variantId", async (req, res) => {
  try {
    return ok(res, await stockRepository.getVariant((req as unknown as AuthedRequest).ctx, String(req.params.variantId)));
  } catch (e) {
    return handleErr(res, e);
  }
});
