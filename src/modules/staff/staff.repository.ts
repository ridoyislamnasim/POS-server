import { prisma } from "../../lib/prisma.js";
import { visibleMembershipWhere, visibleUsersWhere } from "../../lib/scope.js";
import type { RequestContext } from "../../types.js";

/** Data-access for staff/roles/attendance/security. No business rules here. */
export const staffRepository = {
  listRoles(tenantId: string | null) {
    return prisma.role.findMany({
      where: tenantId ? { OR: [{ tenantId }, { tenantId: null }] } : {},
      include: {
        permissions: { include: { permission: true } },
        _count: { select: { users: true } },
      },
    });
  },

  findRole(tenantId: string | null, id: string) {
    return prisma.role.findFirst({
      where: tenantId ? { id, OR: [{ tenantId }, { tenantId: null }] } : { id },
    });
  },

  findRoleByKey(tenantId: string | null, key: string) {
    return prisma.role.findFirst({ where: { tenantId, key }, select: { id: true } });
  },

  createRole(data: { key: string; name: string; tenantId: string | null; permissionIds: string[] }) {
    return prisma.role.create({
      data: {
        key: data.key,
        name: data.name,
        tenantId: data.tenantId,
        permissions: data.permissionIds.length
          ? { create: data.permissionIds.map((permissionId) => ({ permissionId })) }
          : undefined,
      },
    });
  },

  listPermissionsByKeys(keys: string[]) {
    return prisma.permission.findMany({ where: { key: { in: keys } } });
  },

  replaceRolePermissions(roleId: string, permissionIds: string[]) {
    return prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId, permissionId })),
      }),
    ]);
  },

  countRoleUsers(roleId: string) {
    return prisma.userRole.count({ where: { roleId } });
  },

  deleteRole(id: string) {
    return prisma.role.delete({ where: { id } });
  },

  listAttendance(opts: { where: Record<string, unknown>; skip: number; take: number; orderBy: Record<string, unknown> }) {
    return prisma.attendance.findMany({
      where: opts.where as never,
      include: {
        user: { select: { id: true, name: true, email: true } },
        branch: { select: { name: true } },
      },
      orderBy: opts.orderBy as never,
      skip: opts.skip,
      take: opts.take,
    });
  },

  countAttendance(where: Record<string, unknown>) {
    return prisma.attendance.count({ where: where as never });
  },

  findVisibleUser(ctx: RequestContext, userId: string) {
    return prisma.user.findFirst({
      where: { id: userId, ...visibleUsersWhere(ctx) },
      select: { id: true },
    });
  },

  createAttendance(data: Parameters<typeof prisma.attendance.create>[0]["data"]) {
    return prisma.attendance.create({
      data,
      include: { user: { select: { name: true } }, branch: { select: { name: true } } },
    });
  },

  findAttendance(tenantId: string, id: string) {
    return prisma.attendance.findFirst({ where: { id, tenantId } });
  },

  deleteAttendance(id: string) {
    return prisma.attendance.delete({ where: { id } });
  },

  listShiftTemplates(tenantId: string) {
    return prisma.shiftTemplate.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  },

  createShiftTemplate(data: Parameters<typeof prisma.shiftTemplate.create>[0]["data"]) {
    return prisma.shiftTemplate.create({ data });
  },

  listVisibleUserEmails(ctx: RequestContext) {
    return prisma.user.findMany({ where: visibleUsersWhere(ctx), select: { email: true } });
  },

  listLoginAttempts(opts: { where: Record<string, unknown>; skip: number; take: number }) {
    return prisma.loginAttempt.findMany({
      where: opts.where as never,
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
      select: { id: true, email: true, success: true, ip: true, createdAt: true },
    });
  },

  countLoginAttempts(where: Record<string, unknown>) {
    return prisma.loginAttempt.count({ where: where as never });
  },

  listVisibleMemberIds(ctx: RequestContext) {
    return prisma.userTenant.findMany({
      where: visibleMembershipWhere(ctx),
      select: { userId: true },
      distinct: ["userId"],
    });
  },

  listSessions(opts: { where: Record<string, unknown>; skip: number; take: number }) {
    return prisma.session.findMany({
      where: opts.where as never,
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: opts.skip,
      take: opts.take,
    });
  },

  countSessions(where: Record<string, unknown>) {
    return prisma.session.count({ where: where as never });
  },

  findSessionForMembers(id: string, userIds: string[]) {
    return prisma.session.findFirst({ where: { id, userId: { in: userIds } } });
  },

  revokeSession(id: string) {
    return prisma.session.update({ where: { id }, data: { revokedAt: new Date() } });
  },
};
