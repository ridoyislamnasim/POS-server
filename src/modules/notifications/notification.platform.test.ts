import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../lib/prisma.js";
import { createApp } from "../../app.js";

const app = createApp();

const PLATFORM_EMAIL = "platform@pos.local";
const PLATFORM_PASS = "Admin123!";
const CASHIER_EMAIL = "cashier.dhk@nokshi.local";
const CASHIER_PASS = "Cashier123!";
const TENANT_ID = "test-nokshi-tenant";
const TITLE = `platform-visibility-probe-${Date.now()}`;

/**
 * PLATFORM_SUPER_ADMIN calls the notification endpoints without any tenant
 * context and must get properly scoped results — never a tenant rejection.
 * Tenant users keep their existing tenant-scoped behavior.
 */
describe("platform notifications without tenant context", () => {
  let platformId = "";
  let cashierId = "";
  let ownRowId = "";
  let otherRowId = "";

  async function platformToken() {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: PLATFORM_EMAIL, password: PLATFORM_PASS });
    expect(res.status).toBe(200);
    expect(res.body.data.user.isPlatform).toBe(true);
    return res.body.data.accessToken as string;
  }

  async function seedRows() {
    if (ownRowId) return;
    const platform = await prisma.user.findUnique({ where: { email: PLATFORM_EMAIL } });
    const cashier = await prisma.user.findUnique({ where: { email: CASHIER_EMAIL } });
    expect(platform).not.toBeNull();
    expect(cashier).not.toBeNull();
    platformId = platform!.id;
    cashierId = cashier!.id;
    const own = await prisma.notificationLog.create({
      data: {
        tenantId: TENANT_ID,
        recipientUserId: platformId,
        type: "SYSTEM_ALERT",
        title: TITLE,
        message: "addressed to platform admin",
        channel: "IN_APP",
        to: platformId,
        template: "SYSTEM_ALERT",
        status: "SENT",
        payload: {},
      },
    });
    const other = await prisma.notificationLog.create({
      data: {
        tenantId: TENANT_ID,
        recipientUserId: cashierId,
        type: "SYSTEM_ALERT",
        title: `${TITLE}-other`,
        message: "addressed to cashier",
        channel: "IN_APP",
        to: cashierId,
        template: "SYSTEM_ALERT",
        status: "SENT",
        payload: {},
      },
    });
    ownRowId = own.id;
    otherRowId = other.id;
  }

  afterAll(async () => {
    await prisma.notificationLog.deleteMany({
      where: { title: { in: [TITLE, `${TITLE}-other`] } },
    });
  });

  it("GET /recent succeeds for PLATFORM_SUPER_ADMIN without tenantId", async () => {
    await seedRows();
    const res = await request(app)
      .get("/api/v1/extras/notifications/recent")
      .set("Authorization", `Bearer ${await platformToken()}`);

    expect(res.status).toBe(200);
    const rows = res.body.data as { id: string; title: string }[];
    expect(rows.some((r) => r.id === ownRowId)).toBe(true);
    // Recipient scoping still applies: no cross-user leak.
    expect(rows.some((r) => r.id === otherRowId)).toBe(false);
  });

  it("GET /unread-count succeeds for PLATFORM_SUPER_ADMIN without tenantId", async () => {
    await seedRows();
    const res = await request(app)
      .get("/api/v1/extras/notifications/unread-count")
      .set("Authorization", `Bearer ${await platformToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBeGreaterThanOrEqual(1);
  });

  it("tenant user keeps tenant-scoped behavior", async () => {
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: CASHIER_EMAIL, password: CASHIER_PASS, tenantId: TENANT_ID });
    expect(login.status).toBe(200);
    const token = login.body.data.accessToken as string;

    const recent = await request(app)
      .get("/api/v1/extras/notifications/recent")
      .set("Authorization", `Bearer ${token}`);
    expect(recent.status).toBe(200);
    const rows = recent.body.data as { id: string; tenantId: string }[];
    // Tenant isolation: everything returned belongs to the caller's tenant.
    expect(rows.every((r) => r.tenantId === TENANT_ID)).toBe(true);

    const count = await request(app)
      .get("/api/v1/extras/notifications/unread-count")
      .set("Authorization", `Bearer ${token}`);
    expect(count.status).toBe(200);
    expect(typeof count.body.data.count).toBe("number");
  });
});
