import { prisma } from "../../lib/prisma.js";

/** Data-access for org (business/branches/warehouses). No business rules here. */
export const orgRepository = {
  findBusiness(tenantId: string) {
    return prisma.business.findFirst({ where: { tenantId } });
  },

  findTenantWithPlan(tenantId: string) {
    return prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { plan: true, settings: true },
    });
  },

  upsertBusiness(tenantId: string, existingId: string | null, data: Record<string, unknown>) {
    if (existingId) {
      return prisma.business.update({ where: { id: existingId }, data: data as never });
    }
    return prisma.business.create({
      data: { tenantId, ...(data as object), name: (data.name as string) ?? "Business" } as never,
    });
  },

  renameTenant(tenantId: string, name: string) {
    return prisma.tenant.update({ where: { id: tenantId }, data: { name } });
  },

  listBranches(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.branch.findMany({
      where: opts.where as never,
      include: {
        location: true,
        registers: { include: { devices: true } },
        _count: { select: { userBranches: true, sales: true } },
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countBranches(tenantId: string) {
    return prisma.branch.count({ where: { tenantId } });
  },

  findBranch(tenantId: string, id: string) {
    return prisma.branch.findFirst({ where: { id, tenantId } });
  },

  findBranchWithCounts(tenantId: string, id: string) {
    return prisma.branch.findFirst({
      where: { id, tenantId },
      include: { _count: { select: { sales: true, userBranches: true } } },
    });
  },

  createLocation(data: Parameters<typeof prisma.location.create>[0]["data"]) {
    return prisma.location.create({ data });
  },

  createLocationChannel(data: Parameters<typeof prisma.stockLocationChannel.create>[0]["data"]) {
    return prisma.stockLocationChannel.create({ data });
  },

  createBranch(data: Parameters<typeof prisma.branch.create>[0]["data"]) {
    return prisma.branch.create({ data });
  },

  createRegister(data: Parameters<typeof prisma.register.create>[0]["data"]) {
    return prisma.register.create({ data });
  },

  createSequence(data: Parameters<typeof prisma.documentNumberSequence.create>[0]["data"]) {
    return prisma.documentNumberSequence.create({ data });
  },

  updateBranch(id: string, data: Record<string, unknown>) {
    return prisma.branch.update({ where: { id }, data: data as never });
  },

  listRegisters(branchId: string) {
    return prisma.register.findMany({ where: { branchId }, select: { id: true } });
  },

  countShifts(registerIds: string[]) {
    return prisma.shift.count({ where: { registerId: { in: registerIds } } });
  },

  deleteBranchCascade(branchId: string, registerIds: string[]) {
    return prisma.$transaction(async (tx) => {
      if (registerIds.length) {
        await tx.tillDevice.deleteMany({ where: { registerId: { in: registerIds } } });
      }
      await tx.documentNumberSequence.deleteMany({ where: { branchId } });
      await tx.register.deleteMany({ where: { branchId } });
      await tx.branch.delete({ where: { id: branchId } });
    });
  },

  listWarehouses(opts: { where: Record<string, unknown>; skip: number; take: number; order: "asc" | "desc" }) {
    return prisma.location.findMany({
      where: opts.where as never,
      include: { _count: { select: { stock: true } } },
      orderBy: { name: opts.order },
      skip: opts.skip,
      take: opts.take,
    });
  },

  countWarehouses(tenantId: string) {
    return prisma.location.count({ where: { tenantId, type: "WAREHOUSE" } });
  },

  findWarehouse(tenantId: string, id: string) {
    return prisma.location.findFirst({ where: { id, tenantId, type: "WAREHOUSE" } });
  },

  findWarehouseWithStock(tenantId: string, id: string) {
    return prisma.location.findFirst({
      where: { id, tenantId, type: "WAREHOUSE" },
      include: { _count: { select: { stock: true } } },
    });
  },

  updateWarehouse(id: string, name?: string) {
    return prisma.location.update({ where: { id }, data: { name } });
  },

  deleteWarehouse(id: string) {
    return prisma.$transaction(async (tx) => {
      await tx.stockLocationChannel.deleteMany({ where: { locationId: id } });
      await tx.location.delete({ where: { id } });
    });
  },
};
