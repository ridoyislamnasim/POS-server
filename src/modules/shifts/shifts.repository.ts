import { prisma } from "../../lib/prisma.js";

/** Data-access for shifts. No business rules here. */
export const shiftsRepository = {
  list(opts: { where: Record<string, unknown>; skip: number; take: number; order: "asc" | "desc" }) {
    return prisma.shift.findMany({
      where: opts.where as never,
      include: {
        branch: { select: { name: true } },
        register: { select: { name: true } },
        cashier: { select: { id: true, name: true, email: true } },
      },
      orderBy: { openedAt: opts.order },
      skip: opts.skip,
      take: opts.take,
    });
  },

  count(where: Record<string, unknown>) {
    return prisma.shift.count({ where: where as never });
  },

  findCurrent(tenantId: string, cashierId: string) {
    return prisma.shift.findFirst({
      where: { tenantId, cashierId, status: "OPEN" },
      include: { register: true, branch: true },
    });
  },

  findOpenForCashier(tenantId: string, cashierId: string) {
    return prisma.shift.findFirst({
      where: { cashierId, status: "OPEN", tenantId },
    });
  },

  findRegisterOnBranch(registerId: string, tenantId: string, branchId: string) {
    return prisma.register.findFirst({
      where: { id: registerId, tenantId, branchId },
    });
  },

  open(data: Parameters<typeof prisma.shift.create>[0]["data"]) {
    return prisma.shift.create({
      data,
      include: { register: true, branch: true },
    });
  },

  findByIdWithSales(id: string) {
    return prisma.shift.findFirst({
      where: { id },
      include: { sales: { include: { payments: true } } },
    });
  },

  close(id: string, data: { closingCash: string; expectedCash: string }) {
    return prisma.shift.update({
      where: { id },
      data: { status: "CLOSED", closedAt: new Date(), ...data },
    });
  },
};
