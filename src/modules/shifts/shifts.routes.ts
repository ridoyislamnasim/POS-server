import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { ForbiddenError, assertBranch } from "../../lib/scope.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";
import { acceptEnum, createdAtRange, ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { enqueueOutbox } from "../outbox/enqueue.js";

export const shiftsRouter = Router();
shiftsRouter.use(requireAuth, requireTenant);

shiftsRouter.get("/", requirePermission("shift.manage"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const list = parseListQuery(req.query, { sortable: ["openedAt", "status"], defaultSort: "openedAt", defaultOrder: "desc" });
  const status = acceptEnum(req.query.status, ["OPEN", "CLOSED"] as const);
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
  const { rows, pagination } = await withPagination(list, {
    find: (skip, take) =>
      prisma.shift.findMany({
        where,
        include: {
          branch: { select: { name: true } },
          register: { select: { name: true } },
          cashier: { select: { id: true, name: true, email: true } },
        },
        orderBy: { openedAt: list.sortOrder },
        skip,
        take,
      }),
    count: () => prisma.shift.count({ where }),
  });
  return okList(res, rows, pagination);
});

shiftsRouter.get("/current", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const shift = await prisma.shift.findFirst({
    where: { tenantId: ctx.tenantId!, cashierId: ctx.userId, status: "OPEN" },
    include: { register: true, branch: true },
  });
  return ok(res, shift);
});

shiftsRouter.post("/open", requirePermission("shift.open"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const branchId = typeof req.body?.branchId === "string" ? req.body.branchId.trim() : "";
  const registerId = typeof req.body?.registerId === "string" ? req.body.registerId.trim() : "";
  const openingFloat = req.body?.openingFloat;
  if (!branchId || !registerId) {
    return fail(res, "VALIDATION", "branchId and registerId are required");
  }
  try {
    assertBranch(ctx, branchId);
  } catch (e) {
    if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
    throw e;
  }
  const existing = await prisma.shift.findFirst({
    where: { cashierId: ctx.userId, status: "OPEN", tenantId: ctx.tenantId! },
  });
  if (existing) return fail(res, "SHIFT_ALREADY_OPEN", "Close the current shift first", 409);

  const register = await prisma.register.findFirst({
    where: { id: registerId, tenantId: ctx.tenantId!, branchId },
  });
  if (!register) return fail(res, "FORBIDDEN", "Register not on this branch", 403);

  try {
    const shift = await prisma.shift.create({
      data: {
        tenantId: ctx.tenantId!,
        branchId,
        registerId,
        cashierId: ctx.userId,
        businessDate: new Date(ctx.businessDate),
        openingFloat: String(openingFloat ?? "0"),
      },
      include: { register: true, branch: true },
    });
    await writeAudit({
      ctx,
      action: "shift.open",
      entityType: "Shift",
      entityId: shift.id,
      after: { branchId, registerId },
      correlationId: (req as AuthedRequest).correlationId,
    });
    return ok(res, shift, undefined, 201);
  } catch (e) {
    const err = e as Error;
    return fail(res, "VALIDATION", err.message || "Could not open shift", 400);
  }
});

shiftsRouter.post("/:id/close", requirePermission("shift.close"), async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const shift = await prisma.shift.findFirst({
    where: { id: String(req.params.id) },
    include: { sales: { include: { payments: true } } },
  });
  if (!shift || (shift.tenantId !== ctx.tenantId && !ctx.isPlatform)) return fail(res, "FORBIDDEN", "Forbidden", 403);
  if (shift.cashierId !== ctx.userId && !ctx.allBranches && !ctx.isPlatform) {
    return fail(res, "FORBIDDEN", "Forbidden", 403);
  }
  try {
    assertBranch(ctx, shift.branchId);
  } catch (e) {
    if (e instanceof ForbiddenError) return fail(res, "FORBIDDEN", e.message, 403);
    throw e;
  }
  if (shift.status !== "OPEN") return fail(res, "FORBIDDEN", "Forbidden", 403);

  const cashSales = shift.sales
    .flatMap((s) => s.payments)
    .filter((p) => p.method === "CASH" && p.status === "CAPTURED")
    .reduce((n, p) => n + Number(p.amount), 0);
  const expected = Number(shift.openingFloat) + cashSales;
  const closing = Number(req.body?.closingCash ?? expected);

  const updated = await prisma.shift.update({
    where: { id: shift.id },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
      closingCash: String(closing),
      expectedCash: String(expected.toFixed(4)),
    },
  });
  await writeAudit({
    ctx,
    action: "shift.close",
    entityType: "Shift",
    entityId: shift.id,
    after: { expected, closing },
    correlationId: (req as AuthedRequest).correlationId,
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
  return ok(res, {
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
  });
});
