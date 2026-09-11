import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../../lib/prisma.js";
import { createApp } from "../../app.js";
import { ensurePartialIndexes } from "../../lib/ensure-indexes.js";
import { PAYMENT_REQUIRED_MESSAGE } from "../../middleware/auth.js";

const app = createApp();

async function login(email: string, password: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("platform tenant billing", () => {
  let owner: string;
  let platform: string;
  let other: string;
  let nokshiId: string;
  let invoiceId: string;
  let previous: { apiAccessEnabled: boolean; subscriptionStatus: string };

  beforeAll(async () => {
    await ensurePartialIndexes();
    owner = await login("owner@nokshi.local", "Owner123!");
    platform = await login("platform@pos.local", "Admin123!");
    const me = await request(app).get("/api/v1/auth/me").set(auth(owner));
    expect(me.status).toBe(200);
    nokshiId = me.body.data.tenantId;
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: nokshiId } });
    previous = { apiAccessEnabled: tenant.apiAccessEnabled, subscriptionStatus: tenant.subscriptionStatus };

    let otherUser = await prisma.user.findUnique({ where: { email: "cashier@other.local" } });
    if (!otherUser) {
      const otherTenant = await prisma.tenant.create({
        data: { name: `Billing Other ${Date.now()}`, industryPack: "FASHION", country: "BD" },
      });
      otherUser = await prisma.user.create({
        data: {
          email: "cashier@other.local",
          name: "Other Cashier",
          passwordHash: await bcrypt.hash("Cashier123!", 10),
        },
      });
      await prisma.userTenant.create({ data: { userId: otherUser.id, tenantId: otherTenant.id } });
    }
    other = await login("cashier@other.local", "Cashier123!");
  }, 60000);

  afterAll(async () => {
    if (nokshiId) {
      await prisma.tenant.update({
        where: { id: nokshiId },
        data: {
          apiAccessEnabled: previous.apiAccessEnabled,
          apiAccessDisabledAt: null,
          apiAccessDisabledReason: null,
          subscriptionStatus: previous.subscriptionStatus as "TRIAL" | "ACTIVE" | "SUSPENDED",
        },
      });
    }
    await prisma.$disconnect();
  });

  it("blocks tenant owners from platform billing writes", async () => {
    const create = await request(app)
      .post("/api/v1/platform-billing/invoices")
      .set(auth(owner))
      .send({ tenantId: nokshiId, amount: 100 });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe("FORBIDDEN");

    const lock = await request(app)
      .post(`/api/v1/platform-billing/tenants/${nokshiId}/api-access`)
      .set(auth(owner))
      .send({ enabled: false });
    expect(lock.status).toBe(403);
  });

  it("lets the platform owner create, send, mark paid, and receipt", async () => {
    const tenants = await request(app).get("/api/v1/platform-billing/tenants").set(auth(platform));
    expect(tenants.status).toBe(200);
    expect(Array.isArray(tenants.body.data)).toBe(true);

    const created = await request(app)
      .post("/api/v1/platform-billing/invoices")
      .set(auth(platform))
      .send({
        tenantId: nokshiId,
        amount: 2500,
        notes: "Test bill",
      });
    expect(created.status).toBe(201);
    invoiceId = created.body.data.id;
    expect(created.body.data.number).toMatch(/^PLAT-\d{6}-\d{4}$/);
    expect(["PENDING", "OVERDUE"]).toContain(created.body.data.status);

    const sent = await request(app).post(`/api/v1/platform-billing/invoices/${invoiceId}/send`).set(auth(platform));
    expect(sent.status).toBe(200);
    expect(sent.body.data.sentAt).toBeTruthy();

    const paid = await request(app)
      .post(`/api/v1/platform-billing/invoices/${invoiceId}/status`)
      .set(auth(platform))
      .send({ status: "PAID", paidNote: "bKash verified" });
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe("PAID");

    const receipt = await request(app).post(`/api/v1/platform-billing/invoices/${invoiceId}/receipt`).set(auth(platform));
    expect(receipt.status).toBe(200);
  });

  it("keeps invoices isolated to the billed tenant", async () => {
    const mine = await request(app).get("/api/v1/platform-billing/my-invoices").set(auth(owner));
    expect(mine.status).toBe(200);
    expect(mine.body.data.some((r: { id: string }) => r.id === invoiceId)).toBe(true);

    const theirs = await request(app).get("/api/v1/platform-billing/my-invoices").set(auth(other));
    expect(theirs.status).toBe(200);
    expect(theirs.body.data.some((r: { id: string }) => r.id === invoiceId)).toBe(false);

    const stolen = await request(app).get(`/api/v1/platform-billing/invoices/${invoiceId}/pdf`).set(auth(other));
    expect(stolen.status).toBe(403);
  });

  it("disables tenant API with the payment message and restores it", async () => {
    const off = await request(app)
      .post(`/api/v1/platform-billing/tenants/${nokshiId}/api-access`)
      .set(auth(platform))
      .send({ enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.data.apiAccessEnabled).toBe(false);

    const blocked = await request(app).get("/api/v1/catalog/products").set(auth(owner));
    expect(blocked.status).toBe(402);
    expect(blocked.body.error.code).toBe("PAYMENT_REQUIRED");
    expect(blocked.body.error.message).toBe(PAYMENT_REQUIRED_MESSAGE);

    const me = await request(app).get("/api/v1/auth/me").set(auth(owner));
    expect(me.status).toBe(200);
    expect(me.body.data.apiAccessEnabled).toBe(false);
    expect(me.body.data.lockMessage).toBe(PAYMENT_REQUIRED_MESSAGE);

    const bills = await request(app).get("/api/v1/platform-billing/my-invoices").set(auth(owner));
    expect(bills.status).toBe(200);

    const pdf = await request(app).get(`/api/v1/platform-billing/invoices/${invoiceId}/pdf`).set(auth(owner));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);

    const platformStill = await request(app).get("/api/v1/platform-billing/tenants").set(auth(platform));
    expect(platformStill.status).toBe(200);

    const on = await request(app)
      .post(`/api/v1/platform-billing/tenants/${nokshiId}/api-access`)
      .set(auth(platform))
      .send({ enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.data.apiAccessEnabled).toBe(true);

    const open = await request(app).get("/api/v1/catalog/products").set(auth(owner));
    expect(open.status).toBe(200);
  });
});
