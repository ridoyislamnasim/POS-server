import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { cursorWhere, decodeCursor, pageMeta, parseLimit } from "../../lib/cursor.js";
import type { AuthedRequest } from "../../types.js";

export const auditRouter = Router();
auditRouter.use(requireAuth, requireTenant, requirePermission("audit.view"));

auditRouter.get("/", async (req, res) => {
  const ctx = (req as AuthedRequest).ctx;
  const limit = parseLimit(req.query.limit);
  const cursor = decodeCursor(req.query.cursor);
  const rows = await prisma.auditLog.findMany({
    where: { tenantId: ctx.tenantId!, ...cursorWhere(cursor) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return ok(res, rows, pageMeta(rows, limit));
});
