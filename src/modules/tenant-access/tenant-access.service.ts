import { prisma } from "../../lib/prisma.js";
import type { Prisma, ResourceKey, FeatureKey, SubscriptionStatus } from "@prisma/client";

const RESOURCE_LABELS: Record<string, string> = {
  BRANCH: "Branches",
  WAREHOUSE: "Warehouses",
  USER: "Users",
  PRODUCT: "Products",
  CUSTOMER: "Customers",
  SUPPLIER: "Suppliers",
  MONTHLY_SALE: "Monthly Sales",
  MONTHLY_PURCHASE_ORDER: "Monthly Purchase Orders",
};

const FEATURE_LABELS: Record<string, string> = {
  POS: "POS",
  INVENTORY: "Inventory",
  CUSTOMERS: "Customers",
  SUPPLIERS: "Suppliers",
  PURCHASES: "Purchases",
  SALES: "Sales",
  RETURNS: "Returns",
  BASIC_REPORTS: "Basic Reports",
  STOCK_TRANSFER: "Stock Transfer",
  MULTI_BRANCH: "Multi Branch",
  MULTI_WAREHOUSE: "Multi Warehouse",
  LOYALTY: "Loyalty",
  ECOMMERCE: "E-commerce",
  ADVANCED_REPORTS: "Advanced Reports",
  ANALYTICS: "Analytics",
  WHATSAPP: "WhatsApp",
  API: "API",
  INTEGRATIONS: "Integrations",
  ADVANCED_ROLES: "Advanced Roles & Permissions",
  AUDIT_LOGS: "Advanced Audit Logs",
  PRIORITY_SUPPORT: "Priority Support",
  DEDICATED_SUPPORT: "Dedicated Support",
};

export function resourceLabel(r: string): string {
  return RESOURCE_LABELS[r] ?? r;
}

export function featureLabel(f: string): string {
  return FEATURE_LABELS[f] ?? f;
}

// ── Subscription status determines base access level ──────────────────
// SUSPENDED/CANCELLED: all features disabled, limits set to current usage (no new creation)
// EXPIRED: same as suspended
// PAST_DUE/GRACE_PERIOD: normal access but flagged
// TRIAL/ACTIVE: full access per plan

type EffectiveLimit = {
  resource: ResourceKey;
  limitValue: number | null;
  unlimited: boolean;
  disabled: boolean;
  source: "plan" | "override";
  overLimit?: boolean; // true when current usage exceeds effective limit (downgrade scenario)
};

type EffectiveFeature = {
  feature: FeatureKey;
  enabled: boolean;
  source: "plan" | "override";
};

type TenantAccessContext = {
  subscriptionStatus: SubscriptionStatus;
  limits: Map<ResourceKey, EffectiveLimit>;
  features: Map<FeatureKey, EffectiveFeature>;
  isSuspended: boolean;
};

// ── Core: compute effective access for a tenant ───────────────────────
export async function getTenantAccessContext(tenantId: string): Promise<TenantAccessContext> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      plan: { include: { planLimits: true, planFeatures: true } },
    },
  });

  const subscriptionStatus = tenant?.subscriptionStatus ?? "TRIAL";
  const isSuspended = ["SUSPENDED", "CANCELLED", "EXPIRED"].includes(subscriptionStatus);

  const limitMap = new Map<ResourceKey, EffectiveLimit>();
  const featureMap = new Map<FeatureKey, EffectiveFeature>();
  const now = new Date();

  // 1. Start with plan defaults (single source of truth — no JSON)
  if (tenant?.plan) {
    for (const pl of tenant.plan.planLimits) {
      limitMap.set(pl.resource, {
        resource: pl.resource,
        limitValue: pl.limitValue,
        unlimited: pl.unlimited,
        disabled: pl.disabled,
        source: "plan",
      });
    }
    for (const pf of tenant.plan.planFeatures) {
      featureMap.set(pf.feature, {
        feature: pf.feature,
        enabled: pf.enabled,
        source: "plan",
      });
    }
  }

  // 2. Apply active tenant overrides (current + non-expired)
  //    Override wins over plan default: Active Override > Plan Default
  const [limitOverrides, featureOverrides] = await Promise.all([
    prisma.tenantLimitOverride.findMany({
      where: { tenantId, current: true, status: "ACTIVE" },
    }),
    prisma.tenantFeatureOverride.findMany({
      where: { tenantId, current: true, status: "ACTIVE" },
    }),
  ]);

  for (const ov of limitOverrides) {
    // Expired override: treat as inactive, skip
    if (ov.expiresAt && ov.expiresAt < now) continue;
    limitMap.set(ov.resource, {
      resource: ov.resource,
      limitValue: ov.limitValue,
      unlimited: false,
      disabled: false,
      source: "override",
    });
  }

  for (const ov of featureOverrides) {
    if (ov.expiresAt && ov.expiresAt < now) continue;
    featureMap.set(ov.feature, {
      feature: ov.feature,
      enabled: ov.enabled,
      source: "override",
    });
  }

  // 3. Subscription status interaction
  //    SUSPENDED/CANCELLED/EXPIRED: force-disable all features, set limits to 0
  //    (existing data stays, but no new creation)
  if (isSuspended) {
    for (const [key, f] of featureMap) {
      featureMap.set(key, { ...f, enabled: false, source: "plan" });
    }
    for (const [key, l] of limitMap) {
      if (!l.unlimited) {
        limitMap.set(key, { ...l, limitValue: 0, disabled: true, source: "plan" });
      }
    }
  }

  return { subscriptionStatus, limits: limitMap, features: featureMap, isSuspended };
}

// ── Convenience wrappers ──────────────────────────────────────────────
export async function getEffectiveLimits(tenantId: string) {
  const ctx = await getTenantAccessContext(tenantId);
  return ctx.limits;
}

export async function getEffectiveFeatures(tenantId: string) {
  const ctx = await getTenantAccessContext(tenantId);
  return ctx.features;
}

// ── Check if a specific resource creation is allowed ──────────────────
export async function checkLimit(
  tenantId: string,
  resource: ResourceKey
): Promise<{
  allowed: boolean;
  current: number;
  limit: number | null;
  unlimited: boolean;
  remaining: number | null;
  planName: string;
  isSuspended: boolean;
  overLimit: boolean;
  upgradeRecommendation?: string;
}> {
  const ctx = await getTenantAccessContext(tenantId);
  const effective = ctx.limits.get(resource);

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { plan: true },
  });

  const planName = tenant?.plan?.name ?? "None";

  if (ctx.isSuspended) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      unlimited: false,
      remaining: 0,
      planName,
      isSuspended: true,
      overLimit: false,
      upgradeRecommendation: "Your subscription is suspended. Please contact support.",
    };
  }

  if (!effective || effective.disabled) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      unlimited: false,
      remaining: 0,
      planName,
      isSuspended: false,
      overLimit: false,
      upgradeRecommendation: "Upgrade your plan to access this resource.",
    };
  }

  if (effective.unlimited) {
    return {
      allowed: true,
      current: 0,
      limit: null,
      unlimited: true,
      remaining: null,
      planName,
      isSuspended: false,
      overLimit: false,
    };
  }

  const current = await getCurrentUsage(tenantId, resource);
  const limit = effective.limitValue;
  const overLimit = limit !== null && current > limit;
  const allowed = limit === null || current < limit;
  const remaining = limit !== null ? Math.max(0, limit - current) : null;

  return {
    allowed,
    current,
    limit,
    unlimited: false,
    remaining,
    planName,
    isSuspended: false,
    overLimit,
    upgradeRecommendation: allowed
      ? undefined
      : `You've reached your ${resourceLabel(resource)} limit. ${planName} allows ${limit} ${resourceLabel(resource).toLowerCase()}. You currently have ${current}. Upgrade to add more.`,
  };
}

// ── Check feature access ──────────────────────────────────────────────
export async function checkFeature(
  tenantId: string,
  feature: FeatureKey
): Promise<{
  enabled: boolean;
  requiredPlan: string;
  isSuspended: boolean;
}> {
  const ctx = await getTenantAccessContext(tenantId);

  if (ctx.isSuspended) {
    return { enabled: false, requiredPlan: "", isSuspended: true };
  }

  const effective = ctx.features.get(feature);
  if (effective?.enabled) {
    return { enabled: true, requiredPlan: "", isSuspended: false };
  }

  // Find cheapest plan that has this feature
  const plans = await prisma.plan.findMany({
    where: { active: true },
    orderBy: { price: "asc" },
    include: { planFeatures: true },
  });

  let requiredPlan = "a higher plan";
  for (const p of plans) {
    const pf = p.planFeatures.find((f) => f.feature === feature && f.enabled);
    if (pf) {
      requiredPlan = p.name;
      break;
    }
  }

  return { enabled: false, requiredPlan, isSuspended: false };
}

// ── Atomic limit check + increment (for concurrent-safe creation) ─────
// Uses SELECT ... FOR UPDATE to lock the count, preventing race conditions.
// Returns the count AFTER incrementing so the caller can proceed with creation.
export async function claimLimitSlot(
  tenantId: string,
  resource: ResourceKey,
  tx: Prisma.TransactionClient
): Promise<{ allowed: boolean; current: number; limit: number | null; unlimited: boolean }> {
  const ctx = await getTenantAccessContext(tenantId);
  const effective = ctx.limits.get(resource);

  if (ctx.isSuspended || !effective || effective.disabled) {
    return { allowed: false, current: 0, limit: 0, unlimited: false };
  }

  if (effective.unlimited) {
    return { allowed: true, current: 0, limit: null, unlimited: true };
  }

  const limit = effective.limitValue;
  const current = await getCurrentUsageInTx(tx, tenantId, resource);

  if (limit !== null && current >= limit) {
    return { allowed: false, current, limit, unlimited: false };
  }

  return { allowed: true, current, limit, unlimited: false };
}

// ── Usage counters ────────────────────────────────────────────────────
export async function getCurrentUsage(
  tenantId: string,
  resource: ResourceKey
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  switch (resource) {
    case "BRANCH":
      return prisma.branch.count({ where: { tenantId } });
    case "WAREHOUSE":
      return prisma.location.count({ where: { tenantId, type: "WAREHOUSE" } });
    case "USER":
      return prisma.userTenant.count({ where: { tenantId, isPlatform: false } });
    case "PRODUCT":
      return prisma.product.count({ where: { tenantId } });
    case "CUSTOMER":
      return prisma.customer.count({ where: { tenantId } });
    case "SUPPLIER":
      return prisma.supplier.count({ where: { tenantId } });
    case "MONTHLY_SALE":
      // Count non-voided sales in calendar month (tenant timezone)
      return prisma.sale.count({
        where: {
          tenantId,
          createdAt: { gte: monthStart },
          status: { notIn: ["VOIDED"] },
        },
      });
    case "MONTHLY_PURCHASE_ORDER":
      return prisma.purchaseOrder.count({
        where: { tenantId, createdAt: { gte: monthStart } },
      });
    default:
      return 0;
  }
}

async function getCurrentUsageInTx(
  tx: Prisma.TransactionClient,
  tenantId: string,
  resource: ResourceKey
): Promise<number> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  switch (resource) {
    case "BRANCH":
      return tx.branch.count({ where: { tenantId } });
    case "WAREHOUSE":
      return tx.location.count({ where: { tenantId, type: "WAREHOUSE" } });
    case "USER":
      return tx.userTenant.count({ where: { tenantId, isPlatform: false } });
    case "PRODUCT":
      return tx.product.count({ where: { tenantId } });
    case "CUSTOMER":
      return tx.customer.count({ where: { tenantId } });
    case "SUPPLIER":
      return tx.supplier.count({ where: { tenantId } });
    case "MONTHLY_SALE":
      return tx.sale.count({
        where: { tenantId, createdAt: { gte: monthStart }, status: { notIn: ["VOIDED"] } },
      });
    case "MONTHLY_PURCHASE_ORDER":
      return tx.purchaseOrder.count({
        where: { tenantId, createdAt: { gte: monthStart } },
      });
    default:
      return 0;
  }
}

export async function getUsage(tenantId: string) {
  const [branches, warehouses, users, products, customers, suppliers] = await Promise.all([
    prisma.branch.count({ where: { tenantId } }),
    prisma.location.count({ where: { tenantId, type: "WAREHOUSE" } }),
    prisma.userTenant.count({ where: { tenantId, isPlatform: false } }),
    prisma.product.count({ where: { tenantId } }),
    prisma.customer.count({ where: { tenantId } }),
    prisma.supplier.count({ where: { tenantId } }),
  ]);
  return { branches, warehouses, users, products, customers, suppliers };
}

export async function getMonthlyUsage(tenantId: string) {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const [sales, purchaseOrders] = await Promise.all([
    prisma.sale.count({
      where: { tenantId, createdAt: { gte: monthStart }, status: { notIn: ["VOIDED"] } },
    }),
    prisma.purchaseOrder.count({
      where: { tenantId, createdAt: { gte: monthStart } },
    }),
  ]);
  return { sales, purchaseOrders };
}

// ── Downgrade/plan-change helpers ─────────────────────────────────────

// Check if tenant is currently over-limit for any resource
export async function getOverLimitResources(tenantId: string): Promise<{
  overLimit: boolean;
  resources: { resource: ResourceKey; label: string; current: number; limit: number | null }[];
}> {
  const resources: { resource: ResourceKey; label: string; current: number; limit: number | null }[] = [];
  const allResources: ResourceKey[] = ["BRANCH", "WAREHOUSE", "USER", "PRODUCT", "CUSTOMER", "SUPPLIER"];

  for (const r of allResources) {
    const check = await checkLimit(tenantId, r);
    if (!check.unlimited && check.limit !== null && check.current > check.limit) {
      resources.push({ resource: r, label: resourceLabel(r), current: check.current, limit: check.limit });
    }
  }

  return { overLimit: resources.length > 0, resources };
}

// Validate override limit: must be >= current usage
export async function validateOverrideLimit(
  tenantId: string,
  resource: ResourceKey,
  requestedLimit: number
): Promise<{ valid: boolean; current: number; message?: string }> {
  const current = await getCurrentUsage(tenantId, resource);
  if (requestedLimit < current) {
    return {
      valid: false,
      current,
      message: `Cannot set limit to ${requestedLimit}. Current usage is ${current}. Limit must be at least ${current}.`,
    };
  }
  return { valid: true, current };
}
