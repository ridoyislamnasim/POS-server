import type { NotificationType } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

export type Audience =
  | "stock"
  | "sale_ops"
  | "sale_result"
  | "return_approval"
  | "damage"
  | "purchase"
  | "finance"
  | "staff"
  | "shift"
  | "system"
  | "manual";

export type ResolvedRecipient = {
  userId: string;
  primaryRole: string | null;
  email?: string | null;
  phone?: string | null;
};

type LoadedUser = {
  userId: string;
  email: string | null;
  phone: string | null;
  roleKeys: string[];
  permissions: Set<string>;
  allBranches: boolean;
  isPlatform: boolean;
  isOwner: boolean;
  isManager: boolean;
  isCashier: boolean;
  branchIds: string[];
};

async function loadTenantUsers(tenantId: string): Promise<LoadedUser[]> {
  const users = await prisma.user.findMany({
    where: { status: "ACTIVE", tenants: { some: { tenantId, isPlatform: false } } },
    include: {
      tenants: { where: { tenantId } },
      roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      branches: true,
    },
  });
  return users.map((user) => {
    const membership = user.tenants[0];
    const tenantRoles = user.roles.filter((r) => r.role.tenantId == null || r.role.tenantId === tenantId);
    const roleKeys = tenantRoles.map((r) => r.role.key);
    const permissions = new Set(tenantRoles.flatMap((r) => r.role.permissions.map((p) => p.permission.key)));
    const isOwner = roleKeys.includes("TENANT_OWNER") || Boolean(membership?.isPlatform);
    return {
      userId: user.id,
      email: user.email,
      phone: user.phone,
      roleKeys,
      permissions,
      allBranches: Boolean(membership?.allBranches || membership?.isPlatform || isOwner),
      isPlatform: Boolean(membership?.isPlatform),
      isOwner,
      isManager: roleKeys.includes("OUTLET_MANAGER"),
      isCashier: roleKeys.includes("CASHIER") && !isOwner && !roleKeys.includes("OUTLET_MANAGER"),
      branchIds: user.branches.map((b) => b.branchId),
    };
  });
}

function canSeeBranch(user: LoadedUser, branchId?: string | null) {
  if (!branchId) return user.allBranches || user.isOwner || user.isPlatform;
  return user.allBranches || user.branchIds.includes(branchId);
}

function hasPerm(user: LoadedUser, key: string) {
  return user.isOwner || user.isPlatform || user.permissions.has(key);
}

function toRecipient(user: LoadedUser): ResolvedRecipient {
  const primaryRole = user.isOwner
    ? "TENANT_OWNER"
    : user.isManager
      ? "OUTLET_MANAGER"
      : user.isCashier
        ? "CASHIER"
        : user.roleKeys[0] ?? null;
  return { userId: user.userId, primaryRole, email: user.email, phone: user.phone };
}

export async function branchIdForLocation(tenantId: string, locationId: string) {
  const branch = await prisma.branch.findFirst({
    where: { tenantId, locationId },
    select: { id: true },
    orderBy: { code: "asc" },
  });
  return branch?.id ?? null;
}

export async function resolveRecipients(input: {
  tenantId: string;
  audience: Audience;
  branchId?: string | null;
  locationId?: string | null;
  extraUserIds?: string[];
  excludeUserIds?: string[];
  explicitUserId?: string | null;
}): Promise<ResolvedRecipient[]> {
  if (input.audience === "manual" && input.explicitUserId) {
    const user = await prisma.user.findFirst({
      where: { id: input.explicitUserId, status: "ACTIVE", tenants: { some: { tenantId: input.tenantId } } },
      select: { id: true, email: true, phone: true },
    });
    return user ? [{ userId: user.id, primaryRole: null, email: user.email, phone: user.phone }] : [];
  }

  const users = await loadTenantUsers(input.tenantId);
  const exclude = new Set(input.excludeUserIds ?? []);
  const extra = new Set(input.extraUserIds ?? []);
  let branchId = input.branchId ?? null;
  if (!branchId && input.locationId) {
    branchId = await branchIdForLocation(input.tenantId, input.locationId);
  }

  const picked = users.filter((user) => {
    if (exclude.has(user.userId)) return false;
    if (extra.has(user.userId)) return canSeeBranch(user, branchId) || user.isOwner;
    switch (input.audience) {
      case "stock":
        if (branchId) {
          if (!canSeeBranch(user, branchId)) return false;
          return user.isOwner || user.isManager || (user.isCashier && hasPerm(user, "inventory.view"));
        }
        return user.isOwner || hasPerm(user, "warehouse.manage") || (user.isManager && user.allBranches);
      case "sale_ops":
        return canSeeBranch(user, branchId) && (user.isOwner || user.isManager);
      case "sale_result":
        return canSeeBranch(user, branchId) && (user.isOwner || user.isManager || extra.has(user.userId));
      case "return_approval":
        return canSeeBranch(user, branchId) && (user.isOwner || user.isManager || hasPerm(user, "sale.return.approve") || extra.has(user.userId));
      case "damage":
        return canSeeBranch(user, branchId) && (user.isOwner || user.isManager) && hasPerm(user, "inventory.damage.view");
      case "purchase":
        return canSeeBranch(user, branchId) && (user.isOwner || user.isManager) && hasPerm(user, "purchase.view");
      case "finance":
        if (user.isCashier) return false;
        return canSeeBranch(user, branchId) && (user.isOwner || user.isManager) && (hasPerm(user, "finance.view") || hasPerm(user, "payment.view"));
      case "staff":
        return user.isOwner || user.isManager || hasPerm(user, "user.manage") || hasPerm(user, "staff.view") || extra.has(user.userId);
      case "shift":
        return canSeeBranch(user, branchId) && (user.isOwner || user.isManager || extra.has(user.userId));
      case "system":
        return user.isOwner || user.isPlatform;
      default:
        return false;
    }
  });

  const seen = new Set<string>();
  const out: ResolvedRecipient[] = [];
  for (const user of picked) {
    if (seen.has(user.userId)) continue;
    seen.add(user.userId);
    out.push(toRecipient(user));
  }
  return out;
}

export function audienceForType(type: NotificationType): Audience {
  switch (type) {
    case "LOW_STOCK":
    case "OUT_OF_STOCK":
      return "stock";
    case "SALE_COMPLETED":
      return "sale_ops";
    case "SALE_VOIDED":
    case "SALE_RETURNED":
      return "sale_result";
    case "RETURN_APPROVAL":
      return "return_approval";
    case "DAMAGE_SUBMITTED":
    case "DAMAGE_APPROVED":
    case "DAMAGE_REJECTED":
      return "damage";
    case "PURCHASE_CREATED":
    case "PURCHASE_RECEIVED":
    case "PURCHASE_CANCELLED":
      return "purchase";
    case "PAYMENT_RECEIVED":
    case "DUE_PAYMENT":
    case "EXPENSE_CREATED":
    case "CASH_VARIANCE":
      return "finance";
    case "STAFF_CREATED":
    case "STAFF_DEACTIVATED":
    case "ROLE_CHANGED":
    case "BRANCH_CHANGED":
      return "staff";
    case "SHIFT_ALERT":
      return "shift";
    case "MANUAL":
      return "manual";
    default:
      return "system";
  }
}

export async function findTenantUserByAddress(tenantId: string, to: string) {
  const value = to.trim();
  if (!value) return null;
  return prisma.user.findFirst({
    where: {
      status: "ACTIVE",
      tenants: { some: { tenantId } },
      OR: [{ email: { equals: value, mode: "insensitive" } }, { phone: value }, { id: value }],
    },
    select: { id: true, email: true, phone: true, name: true },
  });
}
