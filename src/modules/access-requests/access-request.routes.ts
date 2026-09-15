import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requirePlatform, requireTenant } from "../../middleware/auth.js";
import { tenantId } from "../../lib/erp.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";
import { parseListQuery, withPagination } from "../../lib/list-query.js";
import {
  createRequest,
  listTenantRequests,
  getRequest,
  cancelRequest,
  listAllRequests,
  approveRequest,
  rejectRequest,
} from "./access-request.service.js";
import {
  createLimitOverride,
  createFeatureOverride,
  revokeOverride,
  listAllOverrides,
} from "./override.service.js";
import { getEffectiveLimits, resourceLabel } from "../tenant-access/tenant-access.service.js";

// Tenant-facing routes
export const tenantRequestRouter = Router();
tenantRequestRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

// Create access request — Tenant Owner only, PLAN_CHANGE only
tenantRequestRouter.post("/", requirePermission("tenant.access_request.create"), async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);
  const { type, requestedPlanId, reason } = req.body ?? {};

  // Only PLAN_CHANGE allowed from tenant side
  if (type !== "PLAN_CHANGE") {
    return fail(res, "VALIDATION", "Only plan change requests are allowed");
  }
  if (!requestedPlanId || !reason) {
    return fail(res, "VALIDATION", "requestedPlanId and reason required");
  }

  // Backend role check: must be Tenant Owner
  const isOwner = ctx.roles.includes("TENANT_OWNER");
  if (!isOwner) {
    return fail(res, "FORBIDDEN", "Only tenant owners can submit plan change requests", 403);
  }

  // Get current plan for currentValue
  const tenant = await prisma.tenant.findUnique({ where: { id: tid }, select: { planId: true } });

  try {
    const request = await createRequest(tid, ctx.userId, {
      type: "PLAN_CHANGE",
      requestedPlanId,
      currentValue: 0,
      requestedValue: 0,
      reason,
    });
    await writeAudit({ ctx, action: "tenant.request.create", entityType: "TenantAccessRequest", entityId: request.id, after: request });
    return ok(res, request);
  } catch (e) {
    return fail(res, "VALIDATION", (e as Error).message);
  }
});

// List my requests
tenantRequestRouter.get("/", requirePermission("tenant.access_request.create"), async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);
  const status = req.query.status as string | undefined;
  const requests = await listTenantRequests(tid, status);
  return ok(res, requests);
});

// Cancel pending request
tenantRequestRouter.post("/:id/cancel", requirePermission("tenant.access_request.cancel"), async (req, res) => {
  const ctx = ctxOf(req);
  const id = String(req.params.id);
  try {
    const result = await cancelRequest(id, ctx.userId);
    await writeAudit({ ctx, action: "tenant.request.cancel", entityType: "TenantAccessRequest", entityId: id });
    return ok(res, result);
  } catch (e) {
    return fail(res, "VALIDATION", (e as Error).message);
  }
});

// Platform admin routes
export const platformRequestRouter = Router();
platformRequestRouter.use(requireAuth, requirePlatform, requirePermission("plan.manage"));

// List all requests
platformRequestRouter.get("/", async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const pageSize = Number(req.query.pageSize ?? 20);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const type = typeof req.query.type === "string" ? req.query.type : undefined;
  const tenantFilter = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;

  const result = await listAllRequests({ tenantId: tenantFilter, status, type, page, pageSize });
  return okList(res, result.rows, { page: result.page, limit: result.pageSize, total: result.total, totalPages: Math.ceil(result.total / result.pageSize) });
});

// Get request detail
platformRequestRouter.get("/:id", async (req, res) => {
  const id = String(req.params.id);
  const request = await getRequest(id);
  if (!request) return fail(res, "NOT_FOUND", "Request not found", 404);

  // Include tenant usage context
  const usage = await getEffectiveLimits(request.tenantId);
  const usageArray = Array.from(usage.values()).map((l) => ({
    resource: l.resource,
    label: resourceLabel(l.resource),
    limit: l.limitValue,
    unlimited: l.unlimited,
    source: l.source,
  }));

  return ok(res, { ...request, tenantLimits: usageArray });
});

// Approve request
platformRequestRouter.post("/:id/approve", async (req, res) => {
  const ctx = ctxOf(req);
  const id = String(req.params.id);
  const { expiresAt } = req.body ?? {};

  try {
    const result = await approveRequest(id, ctx.userId, expiresAt ? new Date(expiresAt) : undefined);
    await writeAudit({ ctx, action: "tenant.request.approve", entityType: "TenantAccessRequest", entityId: id, after: { status: "APPROVED" } });
    return ok(res, result);
  } catch (e) {
    return fail(res, "VALIDATION", (e as Error).message);
  }
});

// Reject request
platformRequestRouter.post("/:id/reject", async (req, res) => {
  const ctx = ctxOf(req);
  const id = String(req.params.id);
  const { reason } = req.body ?? {};
  if (!reason) return fail(res, "VALIDATION", "Rejection reason required");

  try {
    const result = await rejectRequest(id, ctx.userId, reason);
    await writeAudit({ ctx, action: "tenant.request.reject", entityType: "TenantAccessRequest", entityId: id, after: { status: "REJECTED", rejectionReason: reason } });
    return ok(res, result);
  } catch (e) {
    return fail(res, "VALIDATION", (e as Error).message);
  }
});

// Platform override management
export const platformOverrideRouter = Router();
platformOverrideRouter.use(requireAuth, requirePlatform, requirePermission("plan.manage"));

// List all active overrides
platformOverrideRouter.get("/", async (req, res) => {
  const tenantFilter = req.query.tenantId as string | undefined;
  const type = req.query.type as "limit" | "feature" | undefined;
  const result = await listAllOverrides({ tenantId: tenantFilter, type });
  return ok(res, result);
});

// Create manual limit override
platformOverrideRouter.post("/limit", async (req, res) => {
  const ctx = ctxOf(req);
  const { tenantId: tid, resource, limitValue, expiresAt, reason } = req.body ?? {};
  if (!tid || !resource || limitValue === undefined) return fail(res, "VALIDATION", "tenantId, resource, and limitValue required");

  const override = await createLimitOverride(tid, resource, limitValue, ctx.userId, expiresAt ? new Date(expiresAt) : undefined, reason);
  await writeAudit({ ctx, action: "tenant.override.create", entityType: "TenantLimitOverride", entityId: override.id, after: { tenantId: tid, resource, limitValue } });
  return ok(res, override, undefined, 201);
});

// Create manual feature override
platformOverrideRouter.post("/feature", async (req, res) => {
  const ctx = ctxOf(req);
  const { tenantId: tid, feature, enabled, expiresAt, reason } = req.body ?? {};
  if (!tid || !feature) return fail(res, "VALIDATION", "tenantId and feature required");

  const override = await createFeatureOverride(tid, feature, enabled ?? true, ctx.userId, expiresAt ? new Date(expiresAt) : undefined, reason);
  await writeAudit({ ctx, action: "tenant.override.create", entityType: "TenantFeatureOverride", entityId: override.id, after: { tenantId: tid, feature, enabled } });
  return ok(res, override, undefined, 201);
});

// Revoke override
platformOverrideRouter.patch("/:id/revoke", async (req, res) => {
  const ctx = ctxOf(req);
  const id = String(req.params.id);
  const { type } = req.body ?? {};
  if (type !== "limit" && type !== "feature") return fail(res, "VALIDATION", "type must be 'limit' or 'feature'");

  const result = await revokeOverride(id, type);
  await writeAudit({ ctx, action: "tenant.override.revoke", entityType: type === "limit" ? "TenantLimitOverride" : "TenantFeatureOverride", entityId: id, after: { status: "REVOKED" } });
  return ok(res, result);
});
