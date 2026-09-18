import { describe, expect, it } from "vitest";
import { visibleNotificationWhere } from "./notification.service.js";
import type { RequestContext } from "../../types.js";

function ctx(partial: Partial<RequestContext>): RequestContext {
  return {
    userId: "user-1",
    tenantId: "tenant-a",
    isPlatform: false,
    branchIds: ["branch-1"],
    allBranches: false,
    permissions: ["notification.view"],
    roles: ["CASHIER"],
    businessDate: "2026-09-10",
    ...partial,
  };
}

describe("visibleNotificationWhere", () => {
  it("scopes to the authenticated tenant and user", () => {
    const where = visibleNotificationWhere(ctx({}));
    expect(where.tenantId).toBe("tenant-a");
    expect(JSON.stringify(where)).toContain("user-1");
    expect(JSON.stringify(where)).toContain("CASHIER");
  });

  it("does not invent a tenant from the client", () => {
    const where = visibleNotificationWhere(ctx({ tenantId: "tenant-a" }));
    expect(where.tenantId).toBe("tenant-a");
    expect(where.tenantId).not.toBe("tenant-b");
  });

  it("returns an impossible id when tenant is missing", () => {
    const where = visibleNotificationWhere(ctx({ tenantId: null }));
    expect(where).toEqual({ id: "__none__" });
  });

  it("lets PLATFORM_SUPER_ADMIN through without a tenant (cross-tenant, recipient-scoped)", () => {
    const where = visibleNotificationWhere(
      ctx({ tenantId: null, isPlatform: true, roles: ["PLATFORM_SUPER_ADMIN"] }),
    );
    expect(where).not.toEqual({ id: "__none__" });
    expect("tenantId" in where).toBe(false);
    expect(JSON.stringify(where)).toContain("user-1");
    expect(JSON.stringify(where)).toContain("PLATFORM_SUPER_ADMIN");
  });

  it("keeps the tenant scope for PLATFORM_SUPER_ADMIN with a tenant context", () => {
    const where = visibleNotificationWhere(
      ctx({ tenantId: "tenant-a", isPlatform: true, roles: ["PLATFORM_SUPER_ADMIN"] }),
    );
    expect(where.tenantId).toBe("tenant-a");
  });
});
