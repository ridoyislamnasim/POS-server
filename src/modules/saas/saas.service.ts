import { createHash, randomBytes } from "node:crypto";
import { PAYMENT_REQUIRED_MESSAGE } from "../../middleware/auth.js";
import { tenantId } from "../../lib/erp.js";
import { acceptId, parseListQuery, withPagination } from "../../lib/list-query.js";
import { prisma } from "../../lib/prisma.js";
import { writeAudit } from "../../lib/audit.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { assertTenantApiKeysAllowed } from "../platform-billing/billing.service.js";
import { enqueueOutbox } from "../outbox/enqueue.js";
import { saasRepository } from "./saas.repository.js";
import type { ChangePlanInput, CreateApiKeyInput, CreateBackupInput } from "./saas.types.js";

function stripKeyHash<T extends { keyHash?: unknown }>(row: T): Omit<T, "keyHash"> {
  const { keyHash: _keyHash, ...safe } = row;
  return safe;
}

function assertPlatformBackupAccess(ctx: RequestContext) {
  if (!ctx.roles.includes("PLATFORM_SUPER_ADMIN")) {
    throw new AppError("FORBIDDEN", "Platform access required", 403);
  }
}

/**
 * Backup target tenant.
 * PLATFORM_SUPER_ADMIN normally has no tenant in context (tenantId = null), so
 * the tenant must come from an explicit, validated tenantId on the request.
 * A non-platform caller (should already be blocked by requirePlatformSuperAdmin)
 * falls back to its own tenant context.
 */
async function backupTenantId(ctx: RequestContext, raw: unknown): Promise<string> {
  const explicit = acceptId(raw);
  if (explicit) {
    const tenant = await prisma.tenant.findUnique({ where: { id: explicit }, select: { id: true } });
    if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    return tenant.id;
  }
  if (ctx.tenantId) return ctx.tenantId;
  throw new AppError("VALIDATION", "tenantId required", 400);
}

/** Tenant SaaS self-service logic. No Express `req`/`res` here. */
export const saasService = {
  async getSubscription(ctx: RequestContext) {
    const tid = tenantId(ctx);
    const [tenant, branches, users, products, warehouses] = await Promise.all([
      saasRepository.findTenantWithPlan(tid),
      saasRepository.countBranches(tid),
      saasRepository.countMembers(tid),
      saasRepository.countProducts(tid),
      saasRepository.countWarehouses(tid),
    ]);
    return { tenant, usage: { branches, users, products, warehouses }, limits: {} };
  },

  async changePlan(ctx: RequestContext, input: ChangePlanInput) {
    const plan = await saasRepository.findActivePlan(String(input.planId ?? ""));
    if (!plan) throw new AppError("NOT_FOUND", "Plan not found", 404);
    return saasRepository.changePlan(tenantId(ctx), plan.id);
  },

  async listApiKeys(ctx: RequestContext) {
    const rows = await saasRepository.listApiKeys(tenantId(ctx));
    return rows.map(stripKeyHash);
  },

  async createApiKey(ctx: RequestContext, input: CreateApiKeyInput) {
    try {
      await assertTenantApiKeysAllowed(tenantId(ctx));
    } catch (e) {
      const err = e as { code?: string };
      if (err.code === "PAYMENT_REQUIRED") {
        throw new AppError("PAYMENT_REQUIRED", PAYMENT_REQUIRED_MESSAGE, 402);
      }
      throw e;
    }
    const name = String(input.name ?? "").trim();
    if (!name) throw new AppError("VALIDATION", "name required", 400);
    const raw = `pos_${randomBytes(24).toString("hex")}`;
    const row = await saasRepository.createApiKey({
      tenantId: tenantId(ctx),
      name,
      keyPrefix: raw.slice(0, 12),
      keyHash: createHash("sha256").update(raw).digest("hex"),
    });
    return { ...stripKeyHash(row), secret: raw };
  },

  async revokeApiKey(ctx: RequestContext, id: string) {
    const existing = await saasRepository.findApiKey(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Key not found", 404);
    const row = await saasRepository.revokeApiKey(existing.id);
    return stripKeyHash(row);
  },

  async createBackup(ctx: RequestContext, input: CreateBackupInput) {
    assertPlatformBackupAccess(ctx);
    const tid = await backupTenantId(ctx, (input as { tenantId?: unknown }).tenantId);
    const payload = { ...(await saasRepository.buildBackupPayload(tid)), exportedAt: new Date().toISOString() };
    const json = JSON.stringify(payload);
    const rec = await saasRepository.createBackupRecord({
      tenantId: tid,
      status: "COMPLETE",
      note: input.note ?? "manual",
      payloadSize: json.length,
      createdById: ctx.userId,
    });
    await writeAudit({ ctx, action: "backup.create", entityType: "BackupRecord", entityId: rec.id });
    await enqueueOutbox(prisma, {
      tenantId: tid,
      type: "BACKUP_RESULT",
      aggregateId: rec.id,
      payload: { ok: true, message: "Manual backup finished.", entityType: "BackupRecord", entityId: rec.id },
    });
    return { record: rec, payload };
  },

  async listBackups(ctx: RequestContext, query: Record<string, unknown>) {
    assertPlatformBackupAccess(ctx);
    const list = parseListQuery(query, { sortable: ["createdAt"], defaultSort: "createdAt", defaultOrder: "desc" });
    const tid = await backupTenantId(ctx, query.tenantId);
    return withPagination(list, {
      find: (skip, take) => saasRepository.listBackups({ tenantId: tid, skip, take }),
      count: () => saasRepository.countBackups(tid),
    });
  },

  async downloadBackup(ctx: RequestContext, id: string, query?: Record<string, unknown>) {
    assertPlatformBackupAccess(ctx);
    const tid = await backupTenantId(ctx, query?.tenantId);
    const rec = await saasRepository.findBackup(tid, id);
    if (!rec) throw new AppError("NOT_FOUND", "Backup not found", 404);
    const payload = { ...(await saasRepository.buildBackupPayload(tid)), exportedAt: rec.createdAt.toISOString() };
    return payload;
  },
};
