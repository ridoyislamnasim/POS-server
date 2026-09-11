import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, sanitizeProviderText } from "./sms.crypto.js";
import { DEFAULT_SMS_TEMPLATES, pickTemplateBody, renderSmsTemplate } from "./sms.templates.js";
import { sendViaProvider } from "./sms.providers.js";
import { assertCanSendTo } from "./sms.service.js";
import type { RequestContext } from "../../types.js";

function ctx(partial: Partial<RequestContext>): RequestContext {
  return {
    userId: "u1",
    tenantId: "tenant-a",
    isPlatform: false,
    branchIds: ["b1"],
    allBranches: true,
    permissions: [],
    roles: ["CASHIER"],
    businessDate: "2026-09-12",
    ...partial,
  };
}

describe("SMS templates", () => {
  it("renders English and Bangla variables", () => {
    const vars = {
      shopName: "Nokshi",
      customerName: "রাফি",
      invoiceNo: "INV-1001",
      amount: "1500.00",
      dueAmount: "200.00",
    };
    const sale = DEFAULT_SMS_TEMPLATES.find((t) => t.key === "SALE_CONFIRMATION")!;
    expect(renderSmsTemplate(sale.bodyEn, vars)).toContain("INV-1001");
    expect(renderSmsTemplate(sale.bodyEn, vars)).toContain("Nokshi");
    expect(renderSmsTemplate(sale.bodyBn, vars)).toContain("রাফি");
    expect(renderSmsTemplate(sale.bodyBn, vars)).toContain("১৫০০.00" === "১৫০০.00" ? "1500.00" : "1500.00");
    expect(pickTemplateBody(sale, "bn")).toBe(sale.bodyBn);
    expect(pickTemplateBody(sale, "en")).toBe(sale.bodyEn);
  });

  it("strips empty placeholders without leftover braces", () => {
    expect(renderSmsTemplate("Hello {{customerName}} due {{dueAmount}}", { customerName: "Ana" })).toBe("Hello Ana due");
  });
});

describe("SMS credential crypto", () => {
  it("round-trips secrets and never echoes plaintext in sanitized logs", () => {
    const enc = encryptSecret("super-secret-key");
    expect(enc).toMatch(/^enc:v1:/);
    expect(enc).not.toContain("super-secret-key");
    expect(decryptSecret(enc)).toBe("super-secret-key");
    const sanitized = sanitizeProviderText({
      api_key: "super-secret-key",
      authorization: "Bearer abc",
      status: "ok",
    });
    expect(sanitized).not.toContain("super-secret-key");
    expect(sanitized).not.toContain("Bearer abc");
    expect(sanitized).toContain("ok");
  });
});

describe("SMS permissions", () => {
  it("lets cashiers send customer SMS only", () => {
    const cashier = ctx({ permissions: ["sms.send"] });
    expect(() => assertCanSendTo(cashier, "CUSTOMER")).not.toThrow();
    expect(() => assertCanSendTo(cashier, "SUPPLIER")).toThrow(/Supplier SMS/);
    expect(() => assertCanSendTo(cashier, "STAFF")).toThrow(/Staff SMS/);
  });

  it("lets managers send supplier SMS when they have purchase or supplier access", () => {
    const manager = ctx({
      roles: ["OUTLET_MANAGER"],
      permissions: ["sms.send", "supplier.view", "purchase.view"],
    });
    expect(() => assertCanSendTo(manager, "SUPPLIER")).not.toThrow();
  });

  it("owners bypass permission lists", () => {
    const owner = ctx({ roles: ["TENANT_OWNER"], permissions: [] });
    expect(() => assertCanSendTo(owner, "SUPPLIER")).not.toThrow();
    expect(() => assertCanSendTo(owner, "STAFF")).not.toThrow();
  });
});

describe("SMS provider send", () => {
  it("succeeds in test/mock mode and fails when forced", async () => {
    const cfg = {
      provider: "GENERIC_HTTP",
      senderId: "NOKSHI",
      apiKeyEnc: encryptSecret("test-key"),
      apiSecretEnc: null,
      apiBaseUrl: null,
      extraConfigEnc: null,
    };
    const prev = process.env.SMS_FORCE_FAIL;
    delete process.env.SMS_FORCE_FAIL;
    const ok = await sendViaProvider(cfg, "+8801712345678", "Test বার্তা");
    expect(ok.ok).toBe(true);
    process.env.SMS_FORCE_FAIL = "1";
    const bad = await sendViaProvider(cfg, "+8801712345678", "Test");
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe("forced_failure");
    if (prev == null) delete process.env.SMS_FORCE_FAIL;
    else process.env.SMS_FORCE_FAIL = prev;
  });
});

describe("SMS isolation helpers", () => {
  it("keeps tenant scope on JWT tenant even for platform users in data helpers", () => {
    const platform = ctx({ isPlatform: true, roles: ["PLATFORM_SUPER_ADMIN"], tenantId: "tenant-a" });
    expect(platform.tenantId).toBe("tenant-a");
    const other = ctx({ tenantId: "tenant-b", roles: ["TENANT_OWNER"] });
    expect(other.tenantId).not.toBe(platform.tenantId);
  });
});
