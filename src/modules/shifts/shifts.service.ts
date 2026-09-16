import { writeAudit } from "../../lib/audit.js";
import { acceptEnum, createdAtRange, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { prisma } from "../../lib/prisma.js";
import { assertBranch } from "../../lib/scope.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { shiftsRepository } from "./shifts.repository.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import type { CloseShiftInput, OpenShiftInput } from "./shifts.types.js";

/**
 * Shift business logic. No Express `req`/`res` here.
 * Branch + tenant isolation mirrors the pre-refactor route guards.
 */
export const shiftsService = {
  async list(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["openedAt", "status"],
      defaultSort: "openedAt",
      defaultOrder: "desc",
    });
    const status = acceptEnum(query.status, ["OPEN", "CLOSED"] as const);
    const dates = createdAtRange(list);
    const q = list.search;
    const where = {
      tenantId: ctx.tenantId!,
      ...(ctx.allBranches || ctx.isPlatform ? {} : { branchId: { in: ctx.branchIds } }),
      ...(status ? { status } : {}),
      ...(dates ? { openedAt: dates } : {}),
      ...(q
        ? {
            OR: [
              { cashier: { name: ilike(q) } },
              { cashier: { email: ilike(q) } },
              { branch: { name: ilike(q) } },
              { register: { name: ilike(q) } },
            ],
          }
        : {}),
    };
    return withPagination(list, {
      find: (skip, take) => shiftsRepository.list({ where, skip, take, order: list.sortOrder }),
      count: () => shiftsRepository.count(where),
    });
  },

  current(ctx: RequestContext) {
    return shiftsRepository.findCurrent(ctx.tenantId!, ctx.userId);
  },

  async open(ctx: RequestContext, input: OpenShiftInput, correlationId?: string) {
    const branchId = typeof input.branchId === "string" ? input.branchId.trim() : "";
    const registerId = typeof input.registerId === "string" ? input.registerId.trim() : "";
    if (!branchId || !registerId) {
      throw new AppError("VALIDATION", "branchId and registerId are required", 400);
    }
    assertBranch(ctx, branchId);

    const existing = await shiftsRepository.findOpenForCashier(ctx.tenantId!, ctx.userId);
    if (existing) throw new AppError("SHIFT_ALREADY_OPEN", "Close the current shift first", 409);

    const register = await shiftsRepository.findRegisterOnBranch(registerId, ctx.tenantId!, branchId);
    if (!register) throw new AppError("FORBIDDEN", "Register not on this branch", 403);

    try {
      const shift = await shiftsRepository.open({
        tenantId: ctx.tenantId!,
        branchId,
        registerId,
        cashierId: ctx.userId,
        businessDate: new Date(ctx.businessDate),
        openingFloat: String(input.openingFloat ?? "0"),
      });
      await writeAudit({
        ctx,
        action: "shift.open",
        entityType: "Shift",
        entityId: shift.id,
        after: { branchId, registerId },
        correlationId,
      });
      return shift;
    } catch (e) {
      if (e instanceof AppError) throw e;
      const err = e as Error;
      throw new AppError("VALIDATION", err.message || "Could not open shift", 400);
    }
  },

  async close(ctx: RequestContext, id: string, input: CloseShiftInput, correlationId?: string) {
    const shift = await shiftsRepository.findByIdWithSales(id);
    if (!shift || (shift.tenantId !== ctx.tenantId && !ctx.isPlatform)) {
      throw new AppError("FORBIDDEN", "Forbidden", 403);
    }
    if (shift.cashierId !== ctx.userId && !ctx.allBranches && !ctx.isPlatform) {
      throw new AppError("FORBIDDEN", "Forbidden", 403);
    }
    assertBranch(ctx, shift.branchId);
    if (shift.status !== "OPEN") throw new AppError("FORBIDDEN", "Forbidden", 403);

    const cashSales = shift.sales
      .flatMap((s) => s.payments)
      .filter((p) => p.method === "CASH" && p.status === "CAPTURED")
      .reduce((n, p) => n + Number(p.amount), 0);
    const expected = Number(shift.openingFloat) + cashSales;
    const closing = Number(input?.closingCash ?? expected);

    const updated = await shiftsRepository.close(shift.id, {
      closingCash: String(closing),
      expectedCash: String(expected.toFixed(4)),
    });
    await writeAudit({
      ctx,
      action: "shift.close",
      entityType: "Shift",
      entityId: shift.id,
      after: { expected, closing },
      correlationId,
    });
    const variance = closing - expected;
    if (Math.abs(variance) >= 1) {
      await enqueueOutbox(prisma, {
        tenantId: ctx.tenantId!,
        type: "SHIFT_ALERT",
        aggregateId: shift.id,
        payload: {
          branchId: shift.branchId,
          cashierUserId: shift.cashierId,
          variance,
          message: `Shift close variance ${variance.toFixed(2)}.`,
          entityType: "Shift",
          entityId: shift.id,
        },
      });
    }
    return {
      ...updated,
      report: {
        type: "Z",
        salesCount: shift.sales.length,
        cashSales,
        openingFloat: shift.openingFloat,
        expectedCash: expected,
        closingCash: closing,
        variance: closing - expected,
      },
    };
  },
};
