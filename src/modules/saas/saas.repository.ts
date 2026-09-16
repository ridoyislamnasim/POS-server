import { prisma } from "../../lib/prisma.js";

/** Data-access for tenant SaaS self-service. No business rules here. */
export const saasRepository = {
  findTenantWithPlan(tenantId: string) {
    return prisma.tenant.findUnique({ where: { id: tenantId }, include: { plan: true } });
  },

  countBranches(tenantId: string) {
    return prisma.branch.count({ where: { tenantId } });
  },

  countMembers(tenantId: string) {
    return prisma.userTenant.count({ where: { tenantId, isPlatform: false } });
  },

  countProducts(tenantId: string) {
    return prisma.product.count({ where: { tenantId } });
  },

  countWarehouses(tenantId: string) {
    return prisma.location.count({ where: { tenantId, type: "WAREHOUSE" } });
  },

  findActivePlan(planId: string) {
    return prisma.plan.findFirst({ where: { id: planId, active: true } });
  },

  changePlan(tenantId: string, planId: string) {
    return prisma.tenant.update({
      where: { id: tenantId },
      data: { planId, subscriptionStatus: "ACTIVE" },
      include: { plan: true },
    });
  },

  listApiKeys(tenantId: string) {
    return prisma.apiKey.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  },

  createApiKey(data: Parameters<typeof prisma.apiKey.create>[0]["data"]) {
    return prisma.apiKey.create({ data });
  },

  findApiKey(tenantId: string, id: string) {
    return prisma.apiKey.findFirst({ where: { id, tenantId } });
  },

  revokeApiKey(id: string) {
    return prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
  },

  buildBackupPayload(tenantId: string) {
    return (async () => ({
      tenant: await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: { businesses: true, settings: true, plan: true },
      }),
      branches: await prisma.branch.findMany({ where: { tenantId } }),
      customers: await prisma.customer.findMany({ where: { tenantId } }),
      suppliers: await prisma.supplier.findMany({ where: { tenantId } }),
      products: await prisma.product.findMany({ where: { tenantId }, include: { variants: true } }),
    }))();
  },

  createBackupRecord(data: Parameters<typeof prisma.backupRecord.create>[0]["data"]) {
    return prisma.backupRecord.create({ data });
  },

  listBackups(opts: { tenantId: string; skip: number; take: number }) {
    return prisma.backupRecord.findMany({
      where: { tenantId: opts.tenantId },
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
      select: { id: true, status: true, note: true, payloadSize: true, createdAt: true, createdById: true },
    });
  },

  countBackups(tenantId: string) {
    return prisma.backupRecord.count({ where: { tenantId } });
  },

  findBackup(tenantId: string, id: string) {
    return prisma.backupRecord.findFirst({ where: { id, tenantId } });
  },
};
