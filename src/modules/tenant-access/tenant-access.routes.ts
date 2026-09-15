import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { tenantId } from "../../lib/erp.js";
import type { AuthedRequest } from "../../types.js";
import {
  getEffectiveLimits,
  getEffectiveFeatures,
  getUsage,
  getMonthlyUsage,
  resourceLabel,
  featureLabel,
  getOverLimitResources,
} from "./tenant-access.service.js";
import type { ResourceKey } from "@prisma/client";

export const tenantAccessRouter = Router();
tenantAccessRouter.use(requireAuth, requireTenant);

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

// Get current plan with effective limits and features
tenantAccessRouter.get("/plan", requirePermission("plan.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tid },
    include: { plan: true },
  });

  const [limits, features] = await Promise.all([
    getEffectiveLimits(tid),
    getEffectiveFeatures(tid),
  ]);

  const limitsArray = Array.from(limits.values()).map((l) => ({
    resource: l.resource,
    label: resourceLabel(l.resource),
    limitValue: l.limitValue,
    unlimited: l.unlimited,
    disabled: l.disabled,
    source: l.source,
  }));

  const featuresArray = Array.from(features.values()).map((f) => ({
    feature: f.feature,
    label: featureLabel(f.feature),
    enabled: f.enabled,
    source: f.source,
  }));

  return ok(res, {
    tenant: {
      id: tenant?.id,
      name: tenant?.name,
      subscriptionStatus: tenant?.subscriptionStatus,
    },
    plan: tenant?.plan
      ? {
          id: tenant.plan.id,
          name: tenant.plan.name,
          code: tenant.plan.code,
          price: tenant.plan.price,
          yearlyPrice: tenant.plan.yearlyPrice,
          currency: tenant.plan.currency,
          interval: tenant.plan.interval,
          displayOrder: tenant.plan.displayOrder,
        }
      : null,
    limits: limitsArray,
    features: featuresArray,
  });
});

// Get current usage vs limits
tenantAccessRouter.get("/usage", requirePermission("plan.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);

  const [usage, limits] = await Promise.all([getUsage(tid), getEffectiveLimits(tid)]);

  const result = Object.entries(usage).map(([key, current]) => {
    const resource = key.toUpperCase() as ResourceKey;
    const effective = limits.get(resource);
    return {
      resource,
      label: resourceLabel(resource),
      current,
      limit: effective?.limitValue ?? null,
      unlimited: effective?.unlimited ?? false,
      disabled: effective?.disabled ?? false,
      remaining: effective?.limitValue != null ? Math.max(0, effective.limitValue - current) : null,
      source: effective?.source ?? "plan",
    };
  });

  return ok(res, result);
});

// Get monthly usage (sales + purchase orders)
tenantAccessRouter.get("/usage/monthly", requirePermission("plan.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);

  const [monthly, limits] = await Promise.all([getMonthlyUsage(tid), getEffectiveLimits(tid)]);

  return ok(res, [
    {
      resource: "MONTHLY_SALE" as ResourceKey,
      label: "Sales (this month)",
      current: monthly.sales,
      limit: limits.get("MONTHLY_SALE")?.limitValue ?? null,
      unlimited: limits.get("MONTHLY_SALE")?.unlimited ?? false,
      remaining: limits.get("MONTHLY_SALE")?.limitValue != null
        ? Math.max(0, limits.get("MONTHLY_SALE")!.limitValue! - monthly.sales)
        : null,
    },
    {
      resource: "MONTHLY_PURCHASE_ORDER" as ResourceKey,
      label: "Purchase Orders (this month)",
      current: monthly.purchaseOrders,
      limit: limits.get("MONTHLY_PURCHASE_ORDER")?.limitValue ?? null,
      unlimited: limits.get("MONTHLY_PURCHASE_ORDER")?.unlimited ?? false,
      remaining: limits.get("MONTHLY_PURCHASE_ORDER")?.limitValue != null
        ? Math.max(0, limits.get("MONTHLY_PURCHASE_ORDER")!.limitValue! - monthly.purchaseOrders)
        : null,
    },
  ]);
});

// Get all plans with limits and features (for comparison table)
tenantAccessRouter.get("/plans", requirePermission("plan.manage"), async (_req, res) => {
  const plans = await prisma.plan.findMany({
    where: { active: true },
    orderBy: { displayOrder: "asc" },
    include: { planLimits: true, planFeatures: true },
  });

  return ok(
    res,
    plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      price: p.price,
      yearlyPrice: p.yearlyPrice,
      currency: p.currency,
      interval: p.interval,
      limits: Object.fromEntries(
        p.planLimits.map((l) => [l.resource, { limitValue: l.limitValue, unlimited: l.unlimited, disabled: l.disabled }])
      ),
      features: Object.fromEntries(
        p.planFeatures.map((f) => [f.feature, f.enabled])
      ),
    }))
  );
});

// Check if tenant is over-limit (for plan change/downgrade UI)
tenantAccessRouter.get("/usage/over-limit", requirePermission("plan.manage"), async (req, res) => {
  const ctx = ctxOf(req);
  const tid = tenantId(ctx);
  const result = await getOverLimitResources(tid);
  return ok(res, result);
});
