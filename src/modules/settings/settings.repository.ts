import { prisma } from "../../lib/prisma.js";

/** Data-access for tenant settings. No business rules here. */
export const settingsRepository = {
  ensureSettings(tenantId: string) {
    return prisma.tenantSettings.upsert({
      where: { tenantId },
      create: { tenantId },
      update: {},
    });
  },

  updateSettings(tenantId: string, data: Record<string, unknown>) {
    return prisma.tenantSettings.update({ where: { tenantId }, data: data as never });
  },

  listTemplates(tenantId: string) {
    return prisma.invoiceTemplate.findMany({ where: { tenantId } });
  },

  listActiveCurrencies() {
    return prisma.currency.findMany({ where: { active: true } });
  },

  listAllCurrencies() {
    return prisma.currency.findMany();
  },

  listTaxCategories(tenantId: string) {
    return prisma.taxCategory.findMany({ where: { tenantId } });
  },

  createTax(tenantId: string, name: string, rate: string) {
    return prisma.taxCategory.create({ data: { tenantId, name, rate } });
  },

  createTemplate(tenantId: string, data: { name: string; kind: string; body: string; isDefault: boolean }) {
    return prisma.invoiceTemplate.create({ data: { tenantId, ...data } });
  },

  findCurrency(code: string) {
    return prisma.currency.findUnique({ where: { code } });
  },

  updateCurrency(code: string, data: { name: string; minorUnits: number }) {
    return prisma.currency.update({ where: { code }, data: { ...data, active: true } });
  },

  createCurrency(data: { code: string; name: string; minorUnits: number }) {
    return prisma.currency.create({ data });
  },
};
