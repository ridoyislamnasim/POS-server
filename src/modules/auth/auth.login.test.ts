import { describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../../app.js";

const app = createApp();

const PLATFORM_EMAIL = "platform@pos.local";
const PLATFORM_PASS = "Admin123!";
const OWNER_EMAIL = "owner@nokshi.local";
const OWNER_PASS = "Owner123!";
const CASHIER_EMAIL = "cashier.dhk@nokshi.local";
const CASHIER_PASS = "Cashier123!";

function decodeJwt(token: string) {
  const payload = jwt.decode(token) as Record<string, unknown> | null;
  expect(payload).not.toBeNull();
  return payload!;
}

describe("POST /api/v1/auth/login", () => {
  describe("Platform Owner / Platform Super Admin", () => {
    it("login without tenantId succeeds and returns tenant: null", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASS });

      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user).toBeDefined();

      const user = res.body.data.user;
      expect(user.email).toBe(PLATFORM_EMAIL);
      expect(user.roles).toContain("PLATFORM_SUPER_ADMIN");
      expect(user.isPlatform).toBe(true);
      expect(user.tenant).toBeNull();

      const payload = decodeJwt(res.body.data.accessToken);
      expect(payload.sub).toBeDefined();
      expect(payload.tenantId).toBeNull();
    });

    it("login with valid tenantId succeeds and preserves tenant context", async () => {
      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASS });

      expect(loginRes.status).toBe(200);

      const userRes = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${loginRes.body.data.accessToken}`);

      expect(userRes.status).toBe(200);
      expect(userRes.body.data.tenants).toBeDefined();
      expect(userRes.body.data.tenants.length).toBeGreaterThan(0);

      const firstTenantId = userRes.body.data.tenants[0].id;

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASS, tenantId: firstTenantId });

      expect(res.status).toBe(200);
      const payload = decodeJwt(res.body.data.accessToken);
      expect(payload.tenantId).toBe(firstTenantId);
      expect(res.body.data.user.tenant).toBeDefined();
      expect(res.body.data.user.tenant.id).toBe(firstTenantId);
    });

    it("login with invalid tenantId returns 403", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASS, tenantId: "nonexistent-tenant-id" });

      expect(res.status).toBe(403);
    });
  });

  describe("Normal tenant-scoped users", () => {
    it("tenant owner login without tenantId auto-resolves to their tenant", async () => {
      const platformLogin = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASS });
      expect(platformLogin.status).toBe(200);

      const meRes = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${platformLogin.body.data.accessToken}`);
      expect(meRes.status).toBe(200);
      const firstTenantId = meRes.body.data.tenants[0].id;

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: OWNER_EMAIL, password: OWNER_PASS });

      expect(res.status).toBe(200);
      expect(res.body.data.user.isPlatform).toBe(false);
      expect(res.body.data.user.tenant).toBeDefined();
      expect(res.body.data.user.tenant.id).toBe(firstTenantId);
      const payload = decodeJwt(res.body.data.accessToken);
      expect(payload.tenantId).toBe(firstTenantId);
    });

    it("tenant owner login with valid tenantId succeeds", async () => {
      const platformLogin = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASS });
      expect(platformLogin.status).toBe(200);

      const meRes = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${platformLogin.body.data.accessToken}`);
      expect(meRes.status).toBe(200);
      const firstTenantId = meRes.body.data.tenants[0].id;

      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: OWNER_EMAIL, password: OWNER_PASS, tenantId: firstTenantId });

      expect(res.status).toBe(200);
      const payload = decodeJwt(res.body.data.accessToken);
      expect(payload.tenantId).toBe(firstTenantId);
    });

    it("tenant owner login with invalid tenantId returns 403", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: OWNER_EMAIL, password: OWNER_PASS, tenantId: "nonexistent-tenant-id" });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe("No tenant access");
    });

    it("tenant owner login with empty-string tenantId returns 403 Tenant ID required", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: OWNER_EMAIL, password: OWNER_PASS, tenantId: "" });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe("Tenant ID required");
    });

    it("cashier login without tenantId auto-resolves to their tenant", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: CASHIER_EMAIL, password: CASHIER_PASS });

      expect(res.status).toBe(200);
      expect(res.body.data.user.isPlatform).toBe(false);
      expect(res.body.data.user.tenant).toBeDefined();
      const payload = decodeJwt(res.body.data.accessToken);
      expect(payload.tenantId).toBe(res.body.data.user.tenant.id);
    });
  });

  describe("Authentication failures", () => {
    it("wrong password returns 401", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: OWNER_EMAIL, password: "WrongPassword123!" });

      expect(res.status).toBe(401);
    });

    it("nonexistent email returns 401", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: "nonexistent@example.com", password: "SomePassword123!" });

      expect(res.status).toBe(401);
    });

    it("missing email returns 400", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ password: OWNER_PASS });

      expect(res.status).toBe(400);
    });

    it("missing password returns 400", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: OWNER_EMAIL });

      expect(res.status).toBe(400);
    });

    it("empty body returns 400", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe("JWT and session integrity", () => {
    it("platform login without tenantId produces valid JWT verifiable by requireAuth", async () => {
      const loginRes = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASS });

      expect(loginRes.status).toBe(200);
      const token = loginRes.body.data.accessToken;

      const meRes = await request(app)
        .get("/api/v1/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.data.isPlatform).toBe(true);
    });

    it("platform login without tenantId sets allBranches to false", async () => {
      const res = await request(app)
        .post("/api/v1/auth/login")
        .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASS });

      expect(res.status).toBe(200);
      expect(res.body.data.user.allBranches).toBe(false);
    });
  });
});
