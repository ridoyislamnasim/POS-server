import { describe, expect, it } from "vitest";
import { bootstrapPlatformSchema } from "./platform-bootstrap.validation.js";

describe("platform-bootstrap validation", () => {
  it("accepts request without tenantId", () => {
    const result = bootstrapPlatformSchema.safeParse({
      name: "Platform Admin 2",
      email: "platform2@shohojhisab.com",
      password: "Strong12345678",
    });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe("Platform Admin 2");
    expect(result.data.email).toBe("platform2@shohojhisab.com");
    expect(result.data.tenantId).toBeUndefined();
  });

  it("accepts request with tenantId", () => {
    const result = bootstrapPlatformSchema.safeParse({
      name: "Platform Admin 3",
      email: "platform3@shohojhisab.com",
      password: "Strong12345678",
      tenantId: "some-tenant-id",
    });
    expect(result.success).toBe(true);
    expect(result.data.tenantId).toBe("some-tenant-id");
  });

  it("rejects request missing name", () => {
    const result = bootstrapPlatformSchema.safeParse({
      email: "test@test.com",
      password: "Strong12345678",
    });
    expect(result.success).toBe(false);
  });

  it("rejects request with invalid email", () => {
    const result = bootstrapPlatformSchema.safeParse({
      name: "Test",
      email: "not-an-email",
      password: "Strong12345678",
    });
    expect(result.success).toBe(false);
  });

  it("rejects request with short password", () => {
    const result = bootstrapPlatformSchema.safeParse({
      name: "Test",
      email: "test@test.com",
      password: "short1",
    });
    expect(result.success).toBe(false);
  });
});
