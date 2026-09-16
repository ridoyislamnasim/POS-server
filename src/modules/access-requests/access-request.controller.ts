import type { NextFunction, Request, Response } from "express";
import { fail, ok, okList } from "../../utils/response.js";
import { tenantId } from "../../lib/erp.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";
import {
  approveRequest,
  cancelRequest,
  createRequest,
  getRequest,
  listAllRequests,
  listTenantRequests,
  rejectRequest,
} from "./access-request.service.js";
import {
  createFeatureOverride,
  createLimitOverride,
  listAllOverrides,
  revokeOverride,
} from "./override.service.js";
import { getEffectiveLimits, resourceLabel } from "../tenant-access/tenant-access.service.js";

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

/** HTTP-only. */
export const tenantRequestController = {
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const tid = tenantId(ctx);
      const { type, requestedPlanId, reason } = req.body ?? {};
      if (type !== "PLAN_CHANGE") {
        return fail(res, "VALIDATION", "Only plan change requests are allowed");
      }
      if (!requestedPlanId) {
        return fail(res, "VALIDATION", "requestedPlanId required");
      }
      if (!ctx.roles.includes("TENANT_OWNER")) {
        return fail(res, "FORBIDDEN", "Only tenant owners can submit plan change requests", 403);
      }
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
      const err = e as Error;
      return fail(res, "VALIDATION", err.message);
    }
  },

  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      return ok(res, await listTenantRequests(tenantId(ctx), req.query.status as string | undefined));
    } catch (e) {
      return next(e);
    }
  },

  async cancel(req: Request, res: Response, _next: NextFunction) {
    const ctx = ctxOf(req);
    const id = String(req.params.id);
    try {
      const result = await cancelRequest(id, ctx.userId);
      await writeAudit({ ctx, action: "tenant.request.cancel", entityType: "TenantAccessRequest", entityId: id });
      return ok(res, result);
    } catch (e) {
      return fail(res, "VALIDATION", (e as Error).message);
    }
  },
};

/** HTTP-only. */
export const platformRequestController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 20);
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const type = typeof req.query.type === "string" ? req.query.type : undefined;
      const tenantFilter = typeof req.query.tenantId === "string" ? req.query.tenantId : undefined;
      const result = await listAllRequests({ tenantId: tenantFilter, status, type, page, pageSize });
      return okList(
        res,
        result.rows,
        { page: result.page, limit: result.pageSize, total: result.total, totalPages: Math.ceil(result.total / result.pageSize) },
      );
    } catch (e) {
      return next(e);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id);
      const request = await getRequest(id);
      if (!request) return fail(res, "NOT_FOUND", "Request not found", 404);
      const usage = await getEffectiveLimits(request.tenantId);
      const usageArray = Array.from(usage.values()).map((l) => ({
        resource: l.resource,
        label: resourceLabel(l.resource),
        limit: l.limitValue,
        unlimited: l.unlimited,
        source: l.source,
      }));
      return ok(res, { ...request, tenantLimits: usageArray });
    } catch (e) {
      return next(e);
    }
  },

  async approve(req: Request, res: Response, _next: NextFunction) {
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
  },

  async reject(req: Request, res: Response, _next: NextFunction) {
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
  },
};

/** HTTP-only. */
export const platformOverrideController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantFilter = req.query.tenantId as string | undefined;
      const type = req.query.type as "limit" | "feature" | undefined;
      return ok(res, await listAllOverrides({ tenantId: tenantFilter, type }));
    } catch (e) {
      return next(e);
    }
  },

  async createLimit(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const { tenantId: tid, resource, limitValue, expiresAt, reason } = req.body ?? {};
      if (!tid || !resource || limitValue === undefined) {
        return fail(res, "VALIDATION", "tenantId, resource, and limitValue required");
      }
      const override = await createLimitOverride(tid, resource, limitValue, ctx.userId, expiresAt ? new Date(expiresAt) : undefined, reason);
      await writeAudit({ ctx, action: "tenant.override.create", entityType: "TenantLimitOverride", entityId: override.id, after: { tenantId: tid, resource, limitValue } });
      return ok(res, override, undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async createFeature(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const { tenantId: tid, feature, enabled, expiresAt, reason } = req.body ?? {};
      if (!tid || !feature) return fail(res, "VALIDATION", "tenantId and feature required");
      const override = await createFeatureOverride(tid, feature, enabled ?? true, ctx.userId, expiresAt ? new Date(expiresAt) : undefined, reason);
      await writeAudit({ ctx, action: "tenant.override.create", entityType: "TenantFeatureOverride", entityId: override.id, after: { tenantId: tid, feature, enabled } });
      return ok(res, override, undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async revoke(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = ctxOf(req);
      const id = String(req.params.id);
      const { type } = req.body ?? {};
      if (type !== "limit" && type !== "feature") return fail(res, "VALIDATION", "type must be 'limit' or 'feature'");
      const result = await revokeOverride(id, type);
      await writeAudit({ ctx, action: "tenant.override.revoke", entityType: type === "limit" ? "TenantLimitOverride" : "TenantFeatureOverride", entityId: id, after: { status: "REVOKED" } });
      return ok(res, result);
    } catch (e) {
      return next(e);
    }
  },
};
