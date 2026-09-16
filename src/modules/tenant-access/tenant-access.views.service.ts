import type { ResourceKey } from "@prisma/client";
import { tenantAccessRepository } from "./tenant-access.repository.js";
import {
  featureLabel,
  getEffectiveFeatures,
  getEffectiveLimits,
  getMonthlyUsage,
  getOverLimitResources,
  getUsage,
  resourceLabel,
} from "./tenant-access.service.js";

/**
 * Read-model shaping for tenant plan/usage endpoints.
 * Keeps Prisma + mapping rules out of controllers/routes.
 */
export const tenantAccessViews = {
  async plan(tenantId: string) {
    const tenant = await tenantAccessRepository.findTenantWithPlan(tenantId);
    const [limits, features] = await Promise.all([
      getEffectiveLimits(tenantId),
      getEffectiveFeatures(tenantId),
    ]);
    return {
      tenant: {
        id: tenant?.id,
        name: tenant?.name,
        subscriptionStatus: tenant?.subscriptionStatus,
        discountType: tenant?.discountType ?? "NONE",
        discountValue: tenant?.discountValue?.toNumber() ?? 0,
        discountReason: tenant?.discountReason ?? null,
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
      limits: Array.from(limits.values()).map((l) => ({
        resource: l.resource,
        label: resourceLabel(l.resource),
        limitValue: l.limitValue,
        unlimited: l.unlimited,
        disabled: l.disabled,
        source: l.source,
      })),
      features: Array.from(features.values()).map((f) => ({
        feature: f.feature,
        label: featureLabel(f.feature),
        enabled: f.enabled,
        source: f.source,
      })),
    };
  },

  async usage(tenantId: string) {
    const [usage, limits] = await Promise.all([getUsage(tenantId), getEffectiveLimits(tenantId)]);
    return Object.entries(usage).map(([key, current]) => {
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
  },

  async monthlyUsage(tenantId: string) {
    const [monthly, limits] = await Promise.all([getMonthlyUsage(tenantId), getEffectiveLimits(tenantId)]);
    return [
      {
        resource: "MONTHLY_SALE" as ResourceKey,
        label: "Sales (this month)",
        current: monthly.sales,
        limit: limits.get("MONTHLY_SALE")?.limitValue ?? null,
        unlimited: limits.get("MONTHLY_SALE")?.unlimited ?? false,
        remaining:
          limits.get("MONTHLY_SALE")?.limitValue != null
            ? Math.max(0, limits.get("MONTHLY_SALE")!.limitValue! - monthly.sales)
            : null,
      },
      {
        resource: "MONTHLY_PURCHASE_ORDER" as ResourceKey,
        label: "Purchase Orders (this month)",
        current: monthly.purchaseOrders,
        limit: limits.get("MONTHLY_PURCHASE_ORDER")?.limitValue ?? null,
        unlimited: limits.get("MONTHLY_PURCHASE_ORDER")?.unlimited ?? false,
        remaining:
          limits.get("MONTHLY_PURCHASE_ORDER")?.limitValue != null
            ? Math.max(0, limits.get("MONTHLY_PURCHASE_ORDER")!.limitValue! - monthly.purchaseOrders)
            : null,
      },
    ];
  },

  async plans() {
    const plans = await tenantAccessRepository.listActivePlansFull();
    return plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      price: p.price,
      yearlyPrice: p.yearlyPrice,
      currency: p.currency,
      interval: p.interval,
      limits: Object.fromEntries(
        p.planLimits.map((l) => [l.resource, { limitValue: l.limitValue, unlimited: l.unlimited, disabled: l.disabled }]),
      ),
      features: Object.fromEntries(p.planFeatures.map((f) => [f.feature, f.enabled])),
    }));
  },

  overLimit(tenantId: string) {
    return getOverLimitResources(tenantId);
  },
};
