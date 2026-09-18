import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { createApp } from "../../app.js";

const app = createApp();

const EMAIL = "bootstrap-no-tenant@pos.local";
const PASS = "Admin123!";

/**
 * Regression test for the bootstrap platform account: a PLATFORM_SUPER_ADMIN
 * with zero tenant memberships must still get a working session —
 * otherwise the sidebar (driven by /me) renders empty and /logout 403s.
 */
describe("PLATFORM_SUPER_ADMIN without tenant membership", () => {
  async function ensureBootstrapUser() {
    const role = await prisma.role.findFirst({
      where: { key: "PLATFORM_SUPER_ADMIN", tenantId: null },
    });
    expect(role).not.toBeNull();
    const passwordHash = await bcrypt.hash(PASS, 10);
    let user = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, status: "ACTIVE" },
      });
    } else {
      user = await prisma.user.create({
        data: { email: EMAIL, name: "Bootstrap Platform", passwordHash },
      });
    }
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role!.id } },
      create: { userId: user.id, roleId: role!.id },
      update: {},
    });
    // The whole point: no UserTenant rows for this account.
    await prisma.userTenant.deleteMany({ where: { userId: user.id } });
    return user;
  }

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: EMAIL } });
    if (user) {
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("login without tenantId succeeds with tenantId=null token", async () => {
    await ensureBootstrapUser();
    const res = await request(app).post("/api/v1/auth/login").send({ email: EMAIL, password: PASS });

    expect(res.status).toBe(200);
    expect(res.body.data.user.isPlatform).toBe(true);
    expect(res.body.data.user.roles).toContain("PLATFORM_SUPER_ADMIN");
    expect(res.body.data.user.tenant).toBeNull();

    const payload = jwt.decode(res.body.data.accessToken) as Record<string, unknown> | null;
    expect(payload).not.toBeNull();
    expect(payload!.tenantId).toBeNull();
  });

  it("/me works with the null-tenant platform token (sidebar data)", async () => {
    await ensureBootstrapUser();
    const login = await request(app).post("/api/v1/auth/login").send({ email: EMAIL, password: PASS });
    expect(login.status).toBe(200);

    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${login.body.data.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body.data.isPlatform).toBe(true);
    expect(me.body.data.tenantId).toBeNull();
    expect(me.body.data.roles).toContain("PLATFORM_SUPER_ADMIN");
  });

  it("/logout works with the null-tenant platform token", async () => {
    await ensureBootstrapUser();
    const login = await request(app).post("/api/v1/auth/login").send({ email: EMAIL, password: PASS });
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken as string;

    const out = await request(app).post("/api/v1/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(out.status).toBe(200);
    expect(out.body.data.signedOut).toBe(true);

    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
  });

  it("login with an unknown tenantId still returns 403", async () => {
    await ensureBootstrapUser();
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: EMAIL, password: PASS, tenantId: "test-nokshi-tenant" });

    expect(res.status).toBe(403);
  });
});
