import { prisma } from "../../lib/prisma.js";
import type { Prisma, ResourceKey, FeatureKey } from "@prisma/client";

export type PlanLimitInput = {
  resource: ResourceKey;
  limitValue?: number | null;
  unlimited?: boolean;
  disabled?: boolean;
};

export type PlanFeatureInput = {
  feature: FeatureKey;
  enabled: boolean;
};

export async function createPlan(data: {
  code: string;
  name: string;
  description?: string;
  interval?: "MONTHLY" | "YEARLY";
  price?: number;
  yearlyPrice?: number;
  currency?: string;
  displayOrder?: number;
}) {
  return prisma.plan.create({
    data: {
      code: data.code.toUpperCase(),
      name: data.name,
      description: data.description,
      interval: data.interval ?? "MONTHLY",
      price: data.price ?? 0,
      yearlyPrice: data.yearlyPrice,
      currency: data.currency ?? "BDT",
      displayOrder: data.displayOrder ?? 0,
    },
  });
}

export async function updatePlan(
  id: string,
  data: {
    name?: string;
    description?: string;
    interval?: "MONTHLY" | "YEARLY";
    price?: number;
    yearlyPrice?: number;
    currency?: string;
    active?: boolean;
    displayOrder?: number;
  }
) {
  return prisma.plan.update({ where: { id }, data });
}

export async function getPlanWithLimitsAndFeatures(id: string) {
  return prisma.plan.findUnique({
    where: { id },
    include: { planLimits: true, planFeatures: true },
  });
}

export async function listPlans() {
  return prisma.plan.findMany({
    orderBy: { displayOrder: "asc" },
    include: { planLimits: true, planFeatures: true },
  });
}

export async function setPlanLimits(planId: string, limits: PlanLimitInput[]) {
  await prisma.$transaction(async (tx) => {
    await tx.planLimit.deleteMany({ where: { planId } });
    for (const l of limits) {
      await tx.planLimit.create({
        data: {
          planId,
          resource: l.resource,
          limitValue: l.unlimited || l.disabled ? null : (l.limitValue ?? null),
          unlimited: l.unlimited ?? false,
          disabled: l.disabled ?? false,
        },
      });
    }
  });
}

export async function setPlanFeatures(planId: string, features: PlanFeatureInput[]) {
  await prisma.$transaction(async (tx) => {
    await tx.planFeature.deleteMany({ where: { planId } });
    for (const f of features) {
      await tx.planFeature.create({
        data: { planId, feature: f.feature, enabled: f.enabled },
      });
    }
  });
}

export async function getFeatureComparison() {
  const plans = await prisma.plan.findMany({
    where: { active: true },
    orderBy: { displayOrder: "asc" },
    include: { planFeatures: true, planLimits: true },
  });
  return plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    price: p.price,
    currency: p.currency,
    interval: p.interval,
    limits: p.planLimits.reduce(
      (acc, l) => {
        acc[l.resource] = { limitValue: l.limitValue, unlimited: l.unlimited, disabled: l.disabled };
        return acc;
      },
      {} as Record<string, { limitValue: number | null; unlimited: boolean; disabled: boolean }>
    ),
    features: p.planFeatures.reduce(
      (acc, f) => {
        acc[f.feature] = f.enabled;
        return acc;
      },
      {} as Record<string, boolean>
    ),
  }));
}
