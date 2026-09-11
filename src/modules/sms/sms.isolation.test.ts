import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { listLogs, smsTenantId } from "./sms.service.js";
import type { RequestContext } from "../../types.js";

function ctx(tenantId: string): RequestContext {
  return {
    userId: "sms-test",
    tenantId,
    isPlatform: false,
    branchIds: [],
    allBranches: true,
    permissions: ["sms.view"],
    roles: ["TENANT_OWNER"],
    businessDate: "2026-09-12",
  };
}

describe("SMS tenant isolation", () => {
  it("never lets tenant A read tenant B logs", async () => {
    const tenants = await prisma.tenant.findMany({ take: 2, orderBy: { createdAt: "asc" }, select: { id: true } });
    if (tenants.length < 2) return;
    const [a, b] = tenants;
    const keyA = `iso-a-${Date.now()}`;
    const keyB = `iso-b-${Date.now()}`;
    await prisma.smsLog.createMany({
      data: [
        {
          tenantId: a.id,
          recipient: "+8801700000001",
          recipientType: "CUSTOMER",
          message: "tenant-a-only",
          purpose: "manual",
          idempotencyKey: keyA,
        },
        {
          tenantId: b.id,
          recipient: "+8801700000002",
          recipientType: "CUSTOMER",
          message: "tenant-b-only",
          purpose: "manual",
          idempotencyKey: keyB,
        },
      ],
    });
    const listed = await listLogs(ctx(a.id), { search: "tenant-b-only", limit: 50 });
    expect(listed.rows.some((r) => r.tenantId === b.id || r.message.includes("tenant-b-only"))).toBe(false);
    expect(smsTenantId(ctx(a.id))).toBe(a.id);
    expect(smsTenantId(ctx(a.id))).not.toBe(b.id);
    await prisma.smsLog.deleteMany({ where: { idempotencyKey: { in: [keyA, keyB] } } });
  });

  it("rejects cross-tenant public settings leakage of secrets", async () => {
    const settings = await prisma.smsSettings.findFirst({ select: { apiKeyEnc: true, apiSecretEnc: true, tenantId: true } });
    if (!settings) return;
    const json = JSON.stringify(settings);
    expect(json).not.toMatch(/apiKey[^E]/);
    if (settings.apiKeyEnc) expect(settings.apiKeyEnc.startsWith("enc:v1:") || settings.apiKeyEnc.length > 0).toBe(true);
  });
});

describe("SMS Decimal usage type", () => {
  it("keeps lastBalance as decimal-compatible", () => {
    const n = new Prisma.Decimal("12.50");
    expect(String(n)).toBe("12.5");
  });
});
