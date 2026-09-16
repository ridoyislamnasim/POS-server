import type { NextFunction, Request, Response } from "express";
import { fail, ok, okList } from "../../utils/response.js";
import { assertBranch } from "../../lib/scope.js";
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

export { listLedger, stockSummary };

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

/** HTTP-only: extract req data, call repository/services, write the response. */
export const inventoryController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await stockRepository.list(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async listLocations(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await stockRepository.listLocations(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async listByLocation(req: Request, res: Response, next: NextFunction) {
    try {
      const locationId = String(req.query.locationId ?? "");
      if (!locationId) return fail(res, "VALIDATION", "locationId required");
      return ok(res, await stockRepository.listByLocation(ctxOf(req), locationId));
    } catch (e) {
      return next(e);
    }
  },

  async listMovements(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await stockRepository.listMovements(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async adjust(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const { variantId, locationId, direction, quantity, reason, notes } = req.body ?? {};
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
      return next(e);
    }
  },

  async transfer(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const { variantId, fromLocationId, toLocationId, quantity, notes } = req.body ?? {};
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
      return next(e);
    }
  },

  async postStockTake(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const { branchId, locationId, notes, lines } = req.body ?? {};
      assertBranch(ctx, branchId);
      const result = await stockRepository.postStockTake(ctx, {
        branchId,
        locationId,
        notes,
        lines: (lines as { variantId: string; countedQty: number }[]).map((l) => ({
          variantId: l.variantId,
          countedQty: Number(l.countedQty),
        })),
      });
      await writeAudit({
        ctx,
        action: "inventory.adjust",
        entityType: "StockTake",
        entityId: result.id,
        after: { lines: (lines as unknown[]).length },
        correlationId: (req as AuthedRequest).correlationId,
      });
      return ok(res, result, undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async listStockTakes(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await stockRepository.listStockTakes(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },

  async reserve(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const { variantId, locationId, quantity, release } = req.body ?? {};
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
      return next(e);
    }
  },

  async listReceipts(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await listReceipts(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async receiptsSummary(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await receiptsSummary(ctxOf(req), {
          from: req.query.from ? String(req.query.from) : undefined,
          to: req.query.to ? String(req.query.to) : undefined,
        }),
      );
    } catch (e) {
      return next(e);
    }
  },

  async getReceipt(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await getReceipt(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async createReceipt(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const body = req.body ?? {};
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
      return next(e);
    }
  },

  async receiveReceipt(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await receiveReceipt({
          ctx: ctxOf(req),
          id: String(req.params.id),
          idempotencyKey: req.headers["idempotency-key"] as string | undefined,
        }),
      );
    } catch (e) {
      return next(e);
    }
  },

  async cancelReceipt(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await cancelReceipt({ ctx: ctxOf(req), id: String(req.params.id), reason: req.body?.reason }),
      );
    } catch (e) {
      return next(e);
    }
  },

  async listDamages(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await listDamages(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async damagesSummary(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await damagesSummary(ctxOf(req), {
          from: req.query.from ? String(req.query.from) : undefined,
          to: req.query.to ? String(req.query.to) : undefined,
        }),
      );
    } catch (e) {
      return next(e);
    }
  },

  async getDamage(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await getDamage(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async createDamage(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const body = req.body ?? {};
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
      return next(e);
    }
  },

  async submitDamage(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await submitDamage({ ctx: ctxOf(req), id: String(req.params.id) }));
    } catch (e) {
      return next(e);
    }
  },

  async approveDamage(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await decideDamage({
          ctx: ctxOf(req),
          id: String(req.params.id),
          approve: true,
          idempotencyKey: req.headers["idempotency-key"] as string | undefined,
        }),
      );
    } catch (e) {
      return next(e);
    }
  },

  async rejectDamage(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await decideDamage({
          ctx: ctxOf(req),
          id: String(req.params.id),
          approve: false,
          rejectReason: req.body?.reason,
          idempotencyKey: req.headers["idempotency-key"] as string | undefined,
        }),
      );
    } catch (e) {
      return next(e);
    }
  },

  async summary(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await stockSummary(ctxOf(req), req.query.locationId ? String(req.query.locationId) : undefined));
    } catch (e) {
      return next(e);
    }
  },

  async getVariant(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await stockRepository.getVariant(ctxOf(req), String(req.params.variantId)));
    } catch (e) {
      return next(e);
    }
  },
};
