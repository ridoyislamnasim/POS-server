import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { requireTenantId } from "./scope.js";
import type { RequestContext } from "../types.js";

export function tenantId(ctx: RequestContext) {
  return requireTenantId(ctx);
}

export function branchScope(ctx: RequestContext) {
  if (ctx.allBranches || ctx.isPlatform) return {};
  return { branchId: { in: ctx.branchIds } };
}

export function withBranchFilter(ctx: RequestContext, branchId?: string | null): RequestContext {
  if (!branchId) return ctx;
  return { ...ctx, allBranches: false, branchIds: [branchId] };
}

export function money(n: number) {
  return n.toFixed(2);
}

export function num(v: unknown) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function nextDocNumber(
  tenantIdValue: string,
  branchId: string,
  documentType: string,
  prefix: string,
) {
  const year = new Date().getFullYear();
  const key = {
    tenantId: tenantIdValue,
    branchId,
    documentType,
    fiscalYear: year,
  };
  const existing = await prisma.documentNumberSequence.findUnique({
    where: { tenantId_branchId_documentType_fiscalYear: key },
  });
  if (!existing) {
    await prisma.documentNumberSequence.create({
      data: { ...key, prefix: `${prefix}-${year}-`, padding: 6, nextNumber: 2 },
    });
    return `${prefix}-${year}-${String(1).padStart(6, "0")}`;
  }
  const used = existing.nextNumber;
  await prisma.documentNumberSequence.update({
    where: { id: existing.id },
    data: { nextNumber: { increment: 1 } },
  });
  return `${existing.prefix}${String(used).padStart(existing.padding, "0")}`;
}

export async function nextDocNumberTx(
  tx: Prisma.TransactionClient,
  tenantIdValue: string,
  branchId: string,
  documentType: string,
  prefix: string,
) {
  const year = new Date().getFullYear();
  const rows = await tx.$queryRaw<Array<{ nextNumber: number; prefix: string; padding: number }>>`
    UPDATE "DocumentNumberSequence"
    SET "nextNumber" = "nextNumber" + 1
    WHERE "tenantId" = ${tenantIdValue}
      AND "branchId" = ${branchId}
      AND "documentType" = ${documentType}
      AND "fiscalYear" = ${year}
    RETURNING "nextNumber", "prefix", "padding"
  `;
  let seq = rows[0];
  if (!seq) {
    const built = `${prefix}-${year}-`;
    try {
      await tx.documentNumberSequence.create({
        data: {
          tenantId: tenantIdValue,
          branchId,
          documentType,
          fiscalYear: year,
          prefix: built,
          padding: 6,
          nextNumber: 1,
        },
      });
    } catch {
      /* unique race */
    }
    const retry = await tx.$queryRaw<Array<{ nextNumber: number; prefix: string; padding: number }>>`
      UPDATE "DocumentNumberSequence"
      SET "nextNumber" = "nextNumber" + 1
      WHERE "tenantId" = ${tenantIdValue}
        AND "branchId" = ${branchId}
        AND "documentType" = ${documentType}
        AND "fiscalYear" = ${year}
      RETURNING "nextNumber", "prefix", "padding"
    `;
    seq = retry[0];
    if (!seq) {
      return `${built}${String(1).padStart(6, "0")}`;
    }
  }
  const used = seq.nextNumber - 1;
  return `${seq.prefix}${String(used).padStart(seq.padding, "0")}`;
}

export function parseCsv(text: string) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  if (!lines.length) return { headers: [] as string[], rows: [] as Record<string, string>[] };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = (cols[i] ?? "").trim();
    });
    return rec;
  });
  return { headers, rows };
}

function splitCsvLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export async function planLimits(ctx: RequestContext) {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId(ctx) },
    include: { plan: true },
  });
  const limits = (t?.plan?.limits ?? {}) as {
    maxBranches?: number;
    maxUsers?: number;
    maxProducts?: number;
    maxWarehouses?: number;
  };
  return { tenant: t, limits };
}
