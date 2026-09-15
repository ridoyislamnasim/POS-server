import type { NextFunction, Request, Response } from "express";
import type { ResourceKey, FeatureKey } from "@prisma/client";
import { checkLimit, checkFeature, resourceLabel } from "../modules/tenant-access/tenant-access.service.js";
import { fail } from "../lib/envelope.js";
import type { AuthedRequest } from "../types.js";

export function requirePlanLimit(resource: ResourceKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ctx = (req as AuthedRequest).ctx;
    if (!ctx?.tenantId || ctx.isPlatform) return next();

    const check = await checkLimit(ctx.tenantId, resource);
    if (!check.allowed) {
      const code = check.isSuspended ? "SUBSCRIPTION_SUSPENDED" : "PLAN_LIMIT_REACHED";
      const status = check.isSuspended ? 403 : 403;
      return fail(res, code, check.upgradeRecommendation ?? "Resource limit reached.", status, {
        resource,
        current: check.current,
        limit: check.limit,
        planName: check.planName,
        isSuspended: check.isSuspended,
        overLimit: check.overLimit,
      });
    }
    next();
  };
}

export function requirePlanFeature(feature: FeatureKey) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ctx = (req as AuthedRequest).ctx;
    if (!ctx?.tenantId || ctx.isPlatform) return next();

    const check = await checkFeature(ctx.tenantId, feature);
    if (!check.enabled) {
      const code = check.isSuspended ? "SUBSCRIPTION_SUSPENDED" : "FEATURE_NOT_ENABLED";
      const message = check.isSuspended
        ? "Your subscription is suspended. Please contact support."
        : `This feature requires ${check.requiredPlan}.`;
      return fail(res, code, message, 403, { feature, requiredPlan: check.requiredPlan, isSuspended: check.isSuspended });
    }
    next();
  };
}
