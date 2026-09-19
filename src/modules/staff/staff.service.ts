import { writeAudit } from "../../lib/audit.js";
import { tenantId } from "../../lib/erp.js";
import {
  acceptEnum,
  acceptId,
  dateRange,
  ilike,
  paginationMeta,
  parseListQuery,
  withPagination,
} from "../../lib/list-query.js";
import { assertBranch } from "../../lib/scope.js";
import { Permissions } from "../../shared/permissions.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { staffRepository } from "./staff.repository.js";
import type { CreateAttendanceInput, CreateRoleInput, CreateShiftTemplateInput, UpdateRoleInput } from "./staff.types.js";

/** Staff/HR business logic. No Express `req`/`res` here. */
export const staffService = {
  listPermissions() {
    return [...Permissions];
  },

  async listRoles(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, { sortable: ["name", "key"], defaultSort: "name", defaultOrder: "asc" });
    const q = list.search.toLowerCase();
    const roles = await staffRepository.listRoles(ctx.isPlatform ? null : tenantId(ctx));
    const mapped = roles
      .filter((r) => r.key !== "PLATFORM_SUPER_ADMIN" || ctx.isPlatform)
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.key.toLowerCase().includes(q))
      .map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        tenantId: r.tenantId,
        users: r._count.users,
        permissions: r.permissions.map((p) => p.permission.key),
      }));
    return { rows: mapped.slice(list.skip, list.skip + list.take), pagination: paginationMeta(mapped.length, list.page, list.limit) };
  },

  async createRole(ctx: RequestContext, input: CreateRoleInput) {
    if (!ctx.roles.includes("PLATFORM_SUPER_ADMIN")) {
      throw new AppError("FORBIDDEN", "Platform access required", 403);
    }
    const allowed = new Set<string>(Permissions);
    const perms = await staffRepository.listPermissionsByKeys(
      (input.permissions ?? []).filter((k) => allowed.has(k)),
    );
    const tenantIdValue = input.tenantId ?? null;
    const existing = await staffRepository.findRoleByKey(tenantIdValue, input.key);
    if (existing) {
      throw new AppError("CONFLICT", `Role key "${input.key}" already exists`, 409);
    }
    const role = await staffRepository.createRole({
      key: input.key,
      name: input.name,
      tenantId: tenantIdValue,
      permissionIds: perms.map((p) => p.id),
    });
    await writeAudit({
      ctx,
      action: "role.create",
      entityType: "Role",
      entityId: role.id,
      after: { key: input.key, name: input.name, tenantId: tenantIdValue, permissions: perms.map((p) => p.key) },
    });
    return {
      id: role.id,
      key: role.key,
      name: role.name,
      tenantId: role.tenantId,
      permissions: perms.map((p) => p.key),
    };
  },

  async updateRole(ctx: RequestContext, id: string, input: UpdateRoleInput) {
    const role = await staffRepository.findRole(ctx.isPlatform ? null : tenantId(ctx), id);
    if (!role) throw new AppError("NOT_FOUND", "Role not found", 404);
    if (role.tenantId == null && !ctx.isPlatform) {
      throw new AppError("FORBIDDEN", "Cannot edit platform role", 403);
    }
    const keys = Array.isArray(input.permissions) ? input.permissions : null;
    if (!keys) throw new AppError("VALIDATION", "permissions array required", 400);
    const allowed = new Set<string>(Permissions);
    const perms = await staffRepository.listPermissionsByKeys(keys.filter((k) => allowed.has(k)));
    await staffRepository.replaceRolePermissions(
      role.id,
      perms.map((p) => p.id),
    );
    await writeAudit({ ctx, action: "role.update", entityType: "Role", entityId: role.id, after: { keys } });
    return { id: role.id, permissions: perms.map((p) => p.key) };
  },

  async deleteRole(ctx: RequestContext, id: string) {
    if (!ctx.roles.includes("PLATFORM_SUPER_ADMIN")) {
      throw new AppError("FORBIDDEN", "Platform access required", 403);
    }
    const role = await staffRepository.findRole(null, id);
    if (!role) throw new AppError("NOT_FOUND", "Role not found", 404);
    if (role.key === "PLATFORM_SUPER_ADMIN") {
      throw new AppError("FORBIDDEN", "Cannot delete the platform super admin role", 403);
    }
    const assigned = await staffRepository.countRoleUsers(role.id);
    if (assigned > 0) {
      throw new AppError("CONFLICT", `Role is assigned to ${assigned} user(s); unassign first`, 409);
    }
    await staffRepository.deleteRole(role.id);
    await writeAudit({
      ctx,
      action: "role.delete",
      entityType: "Role",
      entityId: role.id,
      after: { key: role.key, name: role.name },
    });
    return { id: role.id };
  },

  async listAttendance(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, {
      sortable: ["workDate", "createdAt", "status"],
      defaultSort: "workDate",
      defaultOrder: "desc",
    });
    const status = acceptEnum(query.status, ["PRESENT", "ABSENT", "LATE", "LEAVE", "HALF_DAY"] as const);
    const userId = acceptId(query.userId);
    const dates = dateRange(list.dateFrom, list.dateTo);
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      ...(status ? { status } : {}),
      ...(userId ? { userId } : {}),
      ...(dates ? { workDate: dates } : {}),
      ...(q ? { user: { OR: [{ name: ilike(q) }, { email: ilike(q) }] } } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        staffRepository.listAttendance({
          where,
          skip,
          take,
          orderBy: list.sortBy === "status" ? { status: list.sortOrder } : { workDate: list.sortOrder },
        }),
      count: () => staffRepository.countAttendance(where),
    });
  },

  async createAttendance(ctx: RequestContext, input: CreateAttendanceInput) {
    const { userId, branchId, status, checkIn, checkOut, notes, workDate } = input;
    if (!userId || !branchId) throw new AppError("VALIDATION", "userId and branchId required", 400);
    assertBranch(ctx, branchId);
    const member = await staffRepository.findVisibleUser(ctx, String(userId));
    if (!member) throw new AppError("NOT_FOUND", "User not in tenant", 404);
    return staffRepository.createAttendance({
      tenantId: tenantId(ctx),
      userId,
      branchId,
      status: (status as "PRESENT" | "ABSENT" | "LATE" | "LEAVE" | "HALF_DAY") ?? "PRESENT",
      checkIn: checkIn ? new Date(checkIn) : new Date(),
      checkOut: checkOut ? new Date(checkOut) : null,
      notes,
      workDate: new Date(workDate || ctx.businessDate),
    });
  },

  async deleteAttendance(ctx: RequestContext, id: string) {
    const existing = await staffRepository.findAttendance(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Attendance not found", 404);
    await staffRepository.deleteAttendance(existing.id);
    return { id: existing.id };
  },

  listShiftTemplates(ctx: RequestContext) {
    return staffRepository.listShiftTemplates(tenantId(ctx));
  },

  async createShiftTemplate(ctx: RequestContext, input: CreateShiftTemplateInput) {
    const { name, startTime, endTime, days } = input;
    if (!name || !startTime || !endTime) {
      throw new AppError("VALIDATION", "name, startTime, endTime required", 400);
    }
    return staffRepository.createShiftTemplate({
      tenantId: tenantId(ctx),
      name,
      startTime,
      endTime,
      days: days ?? ["MON", "TUE", "WED", "THU", "FRI", "SAT"],
    });
  },

  async listLoginAttempts(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, { sortable: ["createdAt"], defaultSort: "createdAt", defaultOrder: "desc" });
    const members = await staffRepository.listVisibleUserEmails(ctx);
    const emails = members.map((m) => m.email);
    const q = list.search;
    return withPagination(list, {
      find: (skip, take) =>
        staffRepository.listLoginAttempts({
          where: emails.length
            ? { email: { in: emails, ...(q ? { contains: q, mode: "insensitive" as const } : {}) } }
            : { email: "__none__" },
          skip,
          take,
        }),
      count: () =>
        staffRepository.countLoginAttempts(
          emails.length ? { email: { in: emails } } : { email: "__none__" },
        ),
    });
  },

  async listSessions(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, { sortable: ["createdAt"], defaultSort: "createdAt", defaultOrder: "desc" });
    const memberIds = await staffRepository.listVisibleMemberIds(ctx);
    const ids = memberIds.map((m) => m.userId);
    const q = list.search;
    const where = {
      userId: { in: ids },
      ...(q ? { user: { OR: [{ name: ilike(q) }, { email: ilike(q) }] } } : {}),
    };
    return withPagination(list, {
      find: (skip, take) => staffRepository.listSessions({ where, skip, take }),
      count: () => staffRepository.countSessions(where),
    });
  },

  async revokeSession(ctx: RequestContext, id: string) {
    const memberIds = await staffRepository.listVisibleMemberIds(ctx);
    const existing = await staffRepository.findSessionForMembers(
      id,
      memberIds.map((m) => m.userId),
    );
    if (!existing) throw new AppError("NOT_FOUND", "Session not found", 404);
    return staffRepository.revokeSession(existing.id);
  },
};
