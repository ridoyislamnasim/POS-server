import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { createApp } from "../../app.js";

const app = createApp();

const PLATFORM_EMAIL = "platform@pos.local";
const PLATFORM_PASS = "Admin123!";
const OWNER_EMAIL = "owner@nokshi.local";
const OWNER_PASS = "Owner123!";
const TENANT_ID = "test-nokshi-tenant";
const TENANT_B_ID = `test-staff-roles-tenant-b-${Date.now()}`;
const TENANT_B_ROLE_KEY = `TENANT_B_MANAGER_${Date.now()}`;
const TEST_ROLE_KEY = `TEST_ROLE_${Date.now()}`;

/**
 * Roles are a platform-managed feature: only PLATFORM_SUPER_ADMIN may list,
 * create, or edit roles (no tenant filter for the platform admin, no Prisma
 * `tenantId: null`); every other role is rejected.
 */
describe("/api/v1/staff/roles access rules", () => {
  let tenantBRoleId = "";
  let nomemberUserEmail = "";

  async function login(email: string, password: string, tenantId?: string) {
    return request(app)
      .post("/api/v1/auth/login")
      .send({ email, password, ...(tenantId ? { tenantId } : {}) });
  }

  async function listRoles(token: string) {
    return request(app)
      .get("/api/v1/staff/roles?page=1&limit=25")
      .set("Authorization", `Bearer ${token}`);
  }

  function rowKeys(body: { data: { key: string }[] }) {
    return body.data.map((r) => r.key);
  }

  beforeAll(async () => {
    await prisma.tenant.create({
      data: { id: TENANT_B_ID, name: "Tenant B", industryPack: "FASHION", country: "BD" },
    });
    const roleB = await prisma.role.create({
      data: { tenantId: TENANT_B_ID, key: TENANT_B_ROLE_KEY, name: "Tenant B Manager" },
    });
    tenantBRoleId = roleB.id;

    const cashierRole = await prisma.role.findFirst({ where: { key: "CASHIER", tenantId: null } });
    expect(cashierRole).not.toBeNull();
    nomemberUserEmail = `staff-roles-nomember-${Date.now()}@pos.local`;
    const user = await prisma.user.create({
      data: {
        email: nomemberUserEmail,
        name: "No Member",
        passwordHash: await bcrypt.hash("Nomember123!", 10),
      },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: cashierRole!.id } });
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: nomemberUserEmail } });
    if (user) {
      await prisma.userRole.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.role.deleteMany({ where: { key: TEST_ROLE_KEY } });
    await prisma.role.deleteMany({ where: { id: tenantBRoleId } });
    await prisma.tenant.deleteMany({ where: { id: TENANT_B_ID } });
  });

  it("PLATFORM_SUPER_ADMIN with tenantId = null lists all roles (200)", async () => {
    const loginRes = await login(PLATFORM_EMAIL, PLATFORM_PASS);
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.data.accessToken as string;

    const res = await listRoles(token);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 25 });
    const keys = rowKeys(res.body);
    expect(keys).toContain("PLATFORM_SUPER_ADMIN");
    // No tenant filter: the other tenant's role is visible.
    expect(keys).toContain(TENANT_B_ROLE_KEY);
  });

  it("PLATFORM_SUPER_ADMIN can create a role (201) and it appears in the list", async () => {
    const loginRes = await login(PLATFORM_EMAIL, PLATFORM_PASS);
    const token = loginRes.body.data.accessToken as string;

    const create = await request(app)
      .post("/api/v1/staff/roles")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Test Role", key: TEST_ROLE_KEY, permissions: ["user.manage"] });
    expect(create.status).toBe(201);
    expect(create.body.data).toMatchObject({ key: TEST_ROLE_KEY, name: "Test Role" });

    const res = await listRoles(token);
    expect(rowKeys(res.body)).toContain(TEST_ROLE_KEY);
  });

  it("PLATFORM_SUPER_ADMIN cannot create a duplicate role key (409)", async () => {
    const loginRes = await login(PLATFORM_EMAIL, PLATFORM_PASS);
    const token = loginRes.body.data.accessToken as string;

    const dup = await request(app)
      .post("/api/v1/staff/roles")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Test Role Again", key: TEST_ROLE_KEY });
    expect(dup.status).toBe(409);
  });

  it("rejects invalid role keys for creation (400)", async () => {
    const loginRes = await login(PLATFORM_EMAIL, PLATFORM_PASS);
    const token = loginRes.body.data.accessToken as string;

    const bad = await request(app)
      .post("/api/v1/staff/roles")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bad", key: "lowercase-key" });
    expect(bad.status).toBe(400);
  });

  it("PLATFORM_SUPER_ADMIN can delete an unassigned role (200)", async () => {
    const loginRes = await login(PLATFORM_EMAIL, PLATFORM_PASS);
    const token = loginRes.body.data.accessToken as string;

    const created = await request(app)
      .post("/api/v1/staff/roles")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Delete Me", key: `DELETE_ME_${Date.now()}` });
    expect(created.status).toBe(201);

    const del = await request(app)
      .delete(`/api/v1/staff/roles/${created.body.data.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);

    const list = await listRoles(token);
    expect(rowKeys(list.body)).not.toContain(created.body.data.key);
  });

  it("PLATFORM_SUPER_ADMIN cannot delete the PLATFORM_SUPER_ADMIN role (403)", async () => {
    const loginRes = await login(PLATFORM_EMAIL, PLATFORM_PASS);
    const token = loginRes.body.data.accessToken as string;
    const role = await prisma.role.findFirst({ where: { key: "PLATFORM_SUPER_ADMIN", tenantId: null } });

    const del = await request(app)
      .delete(`/api/v1/staff/roles/${role!.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(403);
  });

  it("PLATFORM_SUPER_ADMIN cannot delete a role still assigned to users (409)", async () => {
    const loginRes = await login(PLATFORM_EMAIL, PLATFORM_PASS);
    const token = loginRes.body.data.accessToken as string;
    const role = await prisma.role.findFirst({ where: { key: "CASHIER", tenantId: null } });
    expect(role).not.toBeNull();

    const del = await request(app)
      .delete(`/api/v1/staff/roles/${role!.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(409);
  });

  it("tenant owner is rejected from listing, creating, editing, and deleting roles", async () => {
    const loginRes = await login(OWNER_EMAIL, OWNER_PASS, TENANT_ID);
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.data.accessToken as string;
    const role = await prisma.role.findFirst({ where: { tenantId: null } });

    const list = await listRoles(token);
    expect(list.status).toBe(403);

    const create = await request(app)
      .post("/api/v1/staff/roles")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Nope", key: "NOPE_ROLE" });
    expect(create.status).toBe(403);

    const patch = await request(app)
      .patch(`/api/v1/staff/roles/${role!.id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ permissions: [] });
    expect(patch.status).toBe(403);

    const del = await request(app)
      .delete(`/api/v1/staff/roles/${role!.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(403);
  });

  it("tenant role without any tenant context remains rejected", async () => {
    const res = await login(nomemberUserEmail, "Nomember123!");
    expect(res.status).toBe(403);
  });
});