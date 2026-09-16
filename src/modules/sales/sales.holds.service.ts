import { writeAudit } from "../../lib/audit.js";
import { assertBranch } from "../../lib/scope.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { saleRepository } from "./sale.repository.js";
import type { HoldSaleInput } from "./sales.types.js";

/**
 * Held-sale (park/retrieve) logic. No Express `req`/`res` here.
 */
export const holdsService = {
  listOpen(ctx: RequestContext) {
    return saleRepository.listOpenHolds(ctx);
  },

  async create(ctx: RequestContext, input: HoldSaleInput, correlationId?: string) {
    const branchId = String(input.branchId ?? "");
    assertBranch(ctx, branchId);
    const row = await saleRepository.createHold(ctx, branchId, input.payload ?? input);
    await writeAudit({
      ctx,
      action: "sale.create",
      entityType: "HeldSale",
      entityId: row.id,
      after: { hold: true },
      correlationId,
    });
    return row;
  },

  async remove(ctx: RequestContext, id: string) {
    const existing = await saleRepository.findHold(ctx, id);
    if (!existing) throw new AppError("FORBIDDEN", "Forbidden", 403);
    await saleRepository.deleteHold(existing.id);
    return { deleted: true };
  },
};
