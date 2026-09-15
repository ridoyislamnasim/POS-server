import { prisma } from "../../lib/prisma.js";
import type { ResourceKey, FeatureKey } from "@prisma/client";
import { validateOverrideLimit } from "../tenant-access/tenant-access.service.js";

// ── Immutable override grants ─────────────────────────────────────────
// Each approval creates a NEW row. Previous current row is marked as not-current.
// Historical rows are kept for audit trail.

export async function createLimitOverride(
  tenantId: string,
  resource: ResourceKey,
  limitValue: number,
  approvedBy: string,
  expiresAt?: Date | null,
  reason?: string,
  requestId?: string
) {
  // Validate: limit must be >= current usage
  const validation = await validateOverrideLimit(tenantId, resource, limitValue);
  if (!validation.valid) {
    throw new Error(validation.message);
  }

  return prisma.$transaction(async (tx) => {
    // Mark any existing current override for this resource as not-current
    await tx.tenantLimitOverride.updateMany({
      where: { tenantId, resource, current: true },
      data: { current: false },
    });

    // Create new immutable grant
    return tx.tenantLimitOverride.create({
      data: {
        tenantId,
        resource,
        limitValue,
        approvedBy,
        expiresAt: expiresAt ?? null,
        reason: reason ?? null,
        requestId: requestId ?? null,
        current: true,
        status: "ACTIVE",
      },
    });
  });
}

export async function createFeatureOverride(
  tenantId: string,
  feature: FeatureKey,
  enabled: boolean,
  approvedBy: string,
  expiresAt?: Date | null,
  reason?: string,
  requestId?: string
) {
  return prisma.$transaction(async (tx) => {
    // Mark existing current override as not-current
    await tx.tenantFeatureOverride.updateMany({
      where: { tenantId, feature, current: true },
      data: { current: false },
    });

    // Create new immutable grant
    return tx.tenantFeatureOverride.create({
      data: {
        tenantId,
        feature,
        enabled,
        approvedBy,
        expiresAt: expiresAt ?? null,
        reason: reason ?? null,
        requestId: requestId ?? null,
        current: true,
        status: "ACTIVE",
      },
    });
  });
}

export async function revokeOverride(id: string, type: "limit" | "feature") {
  if (type === "limit") {
    return prisma.tenantLimitOverride.update({
      where: { id },
      data: { status: "REVOKED", current: false },
    });
  }
  return prisma.tenantFeatureOverride.update({
    where: { id },
    data: { status: "REVOKED", current: false },
  });
}

export async function getActiveOverrides(tenantId: string) {
  const [limitOverrides, featureOverrides] = await Promise.all([
    prisma.tenantLimitOverride.findMany({
      where: { tenantId, current: true, status: "ACTIVE" },
    }),
    prisma.tenantFeatureOverride.findMany({
      where: { tenantId, current: true, status: "ACTIVE" },
    }),
  ]);
  return { limitOverrides, featureOverrides };
}

// Get full override history for a tenant
export async function getOverrideHistory(tenantId: string) {
  const [limitOverrides, featureOverrides] = await Promise.all([
    prisma.tenantLimitOverride.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tenantFeatureOverride.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return { limitOverrides, featureOverrides };
}

export async function listAllOverrides(filters?: {
  tenantId?: string;
  type?: "limit" | "feature";
}) {
  const where = {
    ...(filters?.tenantId ? { tenantId: filters.tenantId } : {}),
    current: true,
    status: "ACTIVE" as const,
  };

  const [limitOverrides, featureOverrides] = await Promise.all([
    ...(filters?.type !== "feature"
      ? [
          prisma.tenantLimitOverride.findMany({
            where,
            orderBy: { createdAt: "desc" },
          }),
        ]
      : []),
    ...(filters?.type !== "limit"
      ? [
          prisma.tenantFeatureOverride.findMany({
            where,
            orderBy: { createdAt: "desc" },
          }),
        ]
      : []),
  ]);

  return {
    limitOverrides: filters?.type !== "feature" ? limitOverrides[0] ?? [] : [],
    featureOverrides: filters?.type !== "limit" ? featureOverrides[0] ?? [] : [],
  };
}
