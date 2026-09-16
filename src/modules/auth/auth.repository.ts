import { prisma } from "../../lib/prisma.js";

/**
 * Data-access for authentication.
 * No business rules here — pure Prisma queries so services stay testable.
 */
export const authRepository = {
  findUserByEmail(email: string) {
    return prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        tenants: { include: { tenant: true } },
        roles: { include: { role: true } },
        branches: { include: { branch: true } },
      },
    });
  },

  countRecentFailedLogins(email: string, since: Date) {
    return prisma.loginAttempt.count({
      where: { email: email.toLowerCase(), createdAt: { gt: since }, success: false },
    });
  },

  recordLoginAttempt(email: string, success: boolean, ip?: string) {
    return prisma.loginAttempt.create({
      data: { email: email.toLowerCase(), success, ip },
    });
  },

  createPendingSession(userId: string, userAgent?: string, ip?: string) {
    return prisma.session.create({
      data: {
        userId,
        refreshTokenHash: "pending",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        userAgent,
        ip,
      },
    });
  },

  storeRefreshHash(sessionId: string, refreshTokenHash: string) {
    return prisma.session.update({
      where: { id: sessionId },
      data: { refreshTokenHash },
    });
  },

  revokeSession(sessionId: string, userId: string) {
    return prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  revokeAllSessions(userId: string) {
    return prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  },

  findUserForMe(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenants: { include: { tenant: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        branches: {
          include: { branch: { include: { location: true, registers: { include: { devices: true } } } } },
        },
      },
    });
  },

  listBranchesForTenant(tenantId: string) {
    return prisma.branch.findMany({
      where: { tenantId },
      include: { location: true, registers: { include: { devices: true } } },
    });
  },

  findTenantApiAccess(tenantId: string) {
    return prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { apiAccessEnabled: true, apiAccessDisabledReason: true },
    });
  },
};
