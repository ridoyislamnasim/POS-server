import { prisma } from "../../lib/prisma.js";
import type { ResourceKey, FeatureKey, RequestType } from "@prisma/client";

export type CreateRequestInput = {
  type: RequestType;
  resource?: ResourceKey;
  feature?: FeatureKey;
  requestedPlanId?: string; // For PLAN_CHANGE
  currentValue?: number;
  requestedValue?: number;
  reason: string;
  expiresAt?: Date;
};

export async function createRequest(
  tenantId: string,
  userId: string,
  data: CreateRequestInput
) {
  // Prevent duplicate pending requests for same resource/feature/plan
  const existing = await prisma.tenantAccessRequest.findFirst({
    where: {
      tenantId,
      status: "PENDING",
      type: data.type,
      ...(data.type === "LIMIT_INCREASE" ? { resource: data.resource! } : {}),
      ...(data.type === "FEATURE_ACCESS" ? { feature: data.feature! } : {}),
      ...(data.type === "PLAN_CHANGE" ? { requestedPlanId: data.requestedPlanId! } : {}),
    },
  });
  if (existing) {
    throw new Error("A pending request for this resource/feature/plan already exists.");
  }

  // Validate requested value > current value for limit increases
  if (data.type === "LIMIT_INCREASE" && data.currentValue !== undefined && data.requestedValue !== undefined) {
    if (data.requestedValue <= data.currentValue) {
      throw new Error("Requested limit must be greater than current limit.");
    }
  }

  // Validate plan exists for PLAN_CHANGE
  if (data.type === "PLAN_CHANGE" && data.requestedPlanId) {
    const targetPlan = await prisma.plan.findUnique({ where: { id: data.requestedPlanId } });
    if (!targetPlan || !targetPlan.active) {
      throw new Error("Target plan not found or inactive.");
    }
  }

  return prisma.tenantAccessRequest.create({
    data: {
      tenantId,
      requestedBy: userId,
      type: data.type,
      resource: data.resource ?? null,
      feature: data.feature ?? null,
      requestedPlanId: data.requestedPlanId ?? null,
      currentValue: data.currentValue ?? null,
      requestedValue: data.requestedValue ?? null,
      reason: data.reason ?? "",
      expiresAt: data.expiresAt ?? null,
    },
  });
}

export async function listTenantRequests(tenantId: string, status?: string) {
  return prisma.tenantAccessRequest.findMany({
    where: {
      tenantId,
      ...(status ? { status: status as any } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getRequest(id: string) {
  return prisma.tenantAccessRequest.findUnique({
    where: { id },
    include: {
      tenant: { include: { plan: true } },
    },
  });
}

export async function cancelRequest(id: string, userId: string) {
  const req = await prisma.tenantAccessRequest.findUnique({ where: { id } });
  if (!req) throw new Error("Request not found.");
  if (req.status !== "PENDING") throw new Error("Only pending requests can be cancelled.");
  if (req.requestedBy !== userId) throw new Error("You can only cancel your own requests.");

  return prisma.tenantAccessRequest.update({
    where: { id },
    data: { status: "CANCELLED" },
  });
}

export async function listAllRequests(filters: {
  tenantId?: string;
  status?: string;
  type?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 20;
  const where = {
    ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
    ...(filters.status ? { status: filters.status as any } : {}),
    ...(filters.type ? { type: filters.type as any } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.tenantAccessRequest.findMany({
      where,
      include: {
        tenant: { include: { plan: true } },
        requestedPlan: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.tenantAccessRequest.count({ where }),
  ]);

  return { rows, total, page, pageSize };
}

export async function approveRequest(
  id: string,
  adminId: string,
  expiresAt?: Date
) {
  const req = await prisma.tenantAccessRequest.findUnique({ where: { id } });
  if (!req) throw new Error("Request not found.");
  if (req.status !== "PENDING") throw new Error("Only pending requests can be approved.");

  // Import here to avoid circular dependency
  const { createLimitOverride, createFeatureOverride } = await import("./override.service.js");

  let overrideId: string | undefined;

  if (req.type === "LIMIT_INCREASE" && req.resource && req.requestedValue !== null) {
    const override = await createLimitOverride(
      req.tenantId,
      req.resource,
      req.requestedValue,
      adminId,
      expiresAt,
      req.reason,
      id
    );
    overrideId = override.id;
  } else if (req.type === "FEATURE_ACCESS" && req.feature) {
    const override = await createFeatureOverride(
      req.tenantId,
      req.feature,
      true,
      adminId,
      expiresAt,
      req.reason,
      id
    );
    overrideId = override.id;
  } else if (req.type === "PLAN_CHANGE" && req.requestedPlanId) {
    // Change the tenant's plan
    await prisma.tenant.update({
      where: { id: req.tenantId },
      data: {
        planId: req.requestedPlanId,
        subscriptionStatus: "ACTIVE",
      },
    });
  }

  return prisma.tenantAccessRequest.update({
    where: { id },
    data: {
      status: "APPROVED",
      reviewedBy: adminId,
      reviewedAt: new Date(),
    },
  });
}

export async function rejectRequest(
  id: string,
  adminId: string,
  rejectionReason: string
) {
  const req = await prisma.tenantAccessRequest.findUnique({ where: { id } });
  if (!req) throw new Error("Request not found.");
  if (req.status !== "PENDING") throw new Error("Only pending requests can be rejected.");

  return prisma.tenantAccessRequest.update({
    where: { id },
    data: {
      status: "REJECTED",
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason,
    },
  });
}
