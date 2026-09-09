import { prisma } from "./prisma.js";
import { CASHIER_KEYS, MANAGER_KEYS, Permissions } from "../shared/permissions.js";

export async function syncPermissions() {
  for (const key of Permissions) {
    await prisma.permission.upsert({
      where: { key },
      create: { key },
      update: {},
    });
  }
  const perms = await prisma.permission.findMany({ where: { key: { in: [...Permissions] } } });
  const idByKey = new Map(perms.map((p) => [p.key, p.id]));

  const roles = await prisma.role.findMany({
    where: { key: { in: ["TENANT_OWNER", "OUTLET_MANAGER", "CASHIER", "PLATFORM_SUPER_ADMIN"] } },
    include: { permissions: true },
  });

  for (const role of roles) {
    const wanted =
      role.key === "CASHIER"
        ? CASHIER_KEYS
        : role.key === "OUTLET_MANAGER"
          ? MANAGER_KEYS
          : [...Permissions];
    const have = new Set(role.permissions.map((p) => p.permissionId));
    const create = wanted
      .map((k) => idByKey.get(k))
      .filter((id): id is string => !!id && !have.has(id))
      .map((permissionId) => ({ roleId: role.id, permissionId }));
    if (create.length) await prisma.rolePermission.createMany({ data: create, skipDuplicates: true });
  }
}
