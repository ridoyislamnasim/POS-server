import { prisma } from "../../lib/prisma.js";

/** Data-access for platform plans. No business rules here. */
export const planRepository = {
  findById(id: string) {
    return prisma.plan.findUnique({ where: { id } });
  },

  findByCode(code: string) {
    return prisma.plan.findUnique({ where: { code: code.toUpperCase() } });
  },
};
