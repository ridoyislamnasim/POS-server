import { describe, expect, it } from "vitest";
import { tenantFilter, visibleMembershipWhere, visibleUsersWhere } from "./scope.js";
import type { RequestContext } from "../types.js";

function ctx(partial: Partial<RequestContext>): RequestContext {
  return {
    userId: "u1",
    tenantId: "tenant-a",
    isPlatform: false,
    branchIds: ["b1"],
    allBranches: true,
    permissions: ["user.manage"],
    roles: ["TENANT_OWNER"],
    businessDate: "2026-09-10",
    ...partial,
  };
}

describe("tenant / user visibility", () => {
  it("locks tenant owners to their tenant", () => {
    expect(tenantFilter(ctx({}))).toEqual({ tenantId: "tenant-a" });
    expect(visibleMembershipWhere(ctx({}))).toEqual({ tenantId: "tenant-a", isPlatform: false });
    expect(visibleUsersWhere(ctx({}))).toEqual({
      AND: [
        { tenants: { some: { tenantId: "tenant-a", isPlatform: false } } },
        { roles: { none: { role: { key: "PLATFORM_SUPER_ADMIN" } } } },
      ],
    });
  });

  it("lets platform super admin see every tenant and user", () => {
    const platform = ctx({ isPlatform: true, roles: ["PLATFORM_SUPER_ADMIN"] });
    expect(tenantFilter(platform)).toEqual({});
    expect(visibleMembershipWhere(platform)).toEqual({});
    expect(visibleUsersWhere(platform)).toEqual({});
  });
});
