import { Router } from "express";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { ForbiddenError, InsufficientStockError, assertBranch } from "../../lib/scope.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";
import { stockRepository } from "./stock.repository.js";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth, requireTenant, requirePermission("inventory.view"));

function handleErr(res: Parameters<typeof fail>[0], e: unknown) {
  if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
  if (e instanceof InsufficientStockError) return fail(res, "INSUFFICIENT_STOCK", e.message, 409);
  const err = e as Error & { code?: string };
  return fail(res, err.code ?? "VALIDATION", err.message, 400);
}

inventoryRouter.get("/", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  try {
    const rows = await stockRepository.list(ctx, {
      q: req.query.q ? String(req.query.q) : undefined,
      locationId: req.query.locationId ? String(req.query.locationId) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      lowStock: req.query.lowStock === "1" || req.query.lowStock === "true",
      outOfStock: req.query.outOfStock === "1" || req.query.outOfStock === "true",
    });
    return ok(res, rows);
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

inventoryRouter.get("/movements", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  try {
    const { rows, meta } = await stockRepository.listMovements(ctx, {
      limit: req.query.limit,
      cursor: req.query.cursor,
      locationId: req.query.locationId ? String(req.query.locationId) : undefined,
      variantId: req.query.variantId ? String(req.query.variantId) : undefined,
    });
    return ok(res, rows, meta);
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

inventoryRouter.get("/:variantId", async (req, res) => {
  try {
    return ok(res, await stockRepository.getVariant((req as unknown as AuthedRequest).ctx, String(req.params.variantId)));
  } catch (e) {
    return handleErr(res, e);
  }
});
