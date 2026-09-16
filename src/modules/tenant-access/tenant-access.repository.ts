import { prisma } from "../../lib/prisma.js";

/** Data-access for tenant plan/usage views. No shaping rules here. */
export const tenantAccessRepository = {
  findTenantWithPlan(tenantId: string) {
    return prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  },

  listActivePlansFull() {
    return prisma.plan.findMany({
      where: { active: true },
      orderBy: { displayOrder: "asc" },
      include: { planLimits: true, planFeatures: true },
    });
  },
};
