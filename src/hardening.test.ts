import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "./lib/prisma.js";
import { createApp } from "./app.js";
import { ensurePartialIndexes } from "./lib/ensure-indexes.js";

const app = createApp();

async function ensureOtherCashier() {
  const existing = await prisma.user.findUnique({ where: { email: "cashier@other.local" } });
  if (existing && existing.status === "ACTIVE") return;
  const tenant = await prisma.tenant.create({
    data: { name: `Other Retail ${Date.now()}`, industryPack: "FASHION", country: "BD" },
  });
  const loc = await prisma.location.create({
    data: { tenantId: tenant.id, type: "STORE", name: "Other Floor" },
  });
  const branch = await prisma.branch.create({
    data: { tenantId: tenant.id, locationId: loc.id, name: "Other Outlet", code: "OTH" },
  });
  const passwordHash = await bcrypt.hash("Cashier123!", 10);
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: { passwordHash, status: "ACTIVE" },
      })
    : await prisma.user.create({
        data: { email: "cashier@other.local", name: "Other Cashier", passwordHash },
      });
  await prisma.userTenant.upsert({
    where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
    create: { userId: user.id, tenantId: tenant.id },
    update: {},
  });
  await prisma.userBranch.upsert({
    where: { userId_branchId: { userId: user.id, branchId: branch.id } },
    create: { userId: user.id, branchId: branch.id },
    update: {},
  });
}

async function login(email: string, password = "Cashier123!") {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("hardening", () => {
  let dhk: string;
  let utt: string;
  let dhkReg: string;
  let uttReg: string;
  let dhkLoc: string;
  let uttLoc: string;
  let dhkToken: string;
  let uttToken: string;
  let ownerToken: string;
  let platformToken: string;
  let otherToken: string;
  let variantId: string;
  let otherVariant: string;

  beforeAll(async () => {
    await ensurePartialIndexes();
    await ensureOtherCashier();
    dhkToken = await login("cashier.dhk@nokshi.local");
    uttToken = await login("cashier.utt@nokshi.local");
    ownerToken = await login("owner@nokshi.local", "Owner123!");
    platformToken = await login("platform@pos.local", "Admin123!");
    otherToken = await login("cashier@other.local");

    const me = await request(app).get("/api/v1/auth/me").set(auth(dhkToken));
    const uttMe = await request(app).get("/api/v1/auth/me").set(auth(uttToken));
    dhk = me.body.data.branches[0].id;
    dhkReg = me.body.data.branches[0].registers[0].id;
    dhkLoc = me.body.data.branches[0].locationId;
    utt = uttMe.body.data.branches[0].id;
    uttReg = uttMe.body.data.branches[0].registers[0].id;
    uttLoc = uttMe.body.data.branches[0].locationId;

    const products = await request(app).get("/api/v1/catalog/products").set(auth(dhkToken));
    variantId = products.body.data[0].variants[0].id;
    otherVariant = products.body.data[0].variants[1].id;

    await prisma.shift.updateMany({
      where: { status: "OPEN" },
      data: { status: "CLOSED", closedAt: new Date() },
    });
    await request(app).post("/api/v1/shifts/open").set(auth(dhkToken)).send({
      branchId: dhk,
      registerId: dhkReg,
      openingFloat: "100",
    });
    await request(app).post("/api/v1/shifts/open").set(auth(uttToken)).send({
      branchId: utt,
      registerId: uttReg,
      openingFloat: "100",
    });
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("health stays up without Redis", async () => {
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    const ready = await request(app).get("/api/ready");
    expect(ready.status).toBe(200);
    expect(ready.body.data.db).toBe(true);
  });

  it("Tenant A cannot read Tenant B sale", async () => {
    await request(app).post("/api/v1/shifts/open").set(auth(dhkToken)).send({
      branchId: dhk,
      registerId: dhkReg,
      openingFloat: "100",
    });
    const sale = await request(app)
      .post("/api/v1/sales")
      .set(auth(dhkToken))
      .set("Idempotency-Key", `idor-a-${Date.now()}`)
      .send({
        branchId: dhk,
        registerId: dhkReg,
        deviceId: "DHK-TILL-01",
        clientTransactionId: `a-${Date.now()}`,
        items: [{ variantId, qty: 1 }],
        payments: [{ method: "CASH", amount: "10000" }],
      });
    expect(sale.status, JSON.stringify(sale.body)).toBe(201);
    const steal = await request(app)
      .get(`/api/v1/sales/${sale.body.data.id}`)
      .set(auth(otherToken));
    expect(steal.status).toBe(403);
  });

  it("Dhanmondi cashier cannot read Uttara sale or PDF", async () => {
    const sale = await request(app)
      .post("/api/v1/sales")
      .set(auth(uttToken))
      .set("Idempotency-Key", `utt-sale-${Date.now()}`)
      .send({
        branchId: utt,
        registerId: uttReg,
        deviceId: "UTT-TILL-01",
        clientTransactionId: `utt-${Date.now()}`,
        items: [{ variantId, qty: 1 }],
        payments: [{ method: "CASH", amount: "10000" }],
      });
    expect(sale.status).toBe(201);
    const id = sale.body.data.id;
    const get = await request(app).get(`/api/v1/sales/${id}`).set(auth(dhkToken));
    expect(get.status).toBe(403);
    const pdf = await request(app).get(`/api/v1/sales/${id}/documents/invoice.pdf`).set(auth(dhkToken));
    expect(pdf.status).toBe(403);
  });

  it("Dhanmondi cashier cannot read Uttara inventory", async () => {
    const res = await request(app)
      .get(`/api/v1/inventory/stock?locationId=${uttLoc}`)
      .set(auth(dhkToken));
    expect(res.status).toBe(403);
    const own = await request(app)
      .get(`/api/v1/inventory/stock?locationId=${dhkLoc}`)
      .set(auth(dhkToken));
    expect(own.status).toBe(200);
  });

  it("Cashier cannot call Users API", async () => {
    const res = await request(app).get("/api/v1/users").set(auth(dhkToken));
    expect(res.status).toBe(403);
  });

  it("Tenant owner cannot assign platform admin role", async () => {
    const res = await request(app).post("/api/v1/users").set(auth(ownerToken)).send({
      name: "Nope",
      email: `nope-${Date.now()}@nokshi.local`,
      password: "Temp123!",
      roleKey: "PLATFORM_SUPER_ADMIN",
    });
    expect(res.status).toBe(403);
  });

  it("Tenant owner sees only their shop staff, never platform or other tenants", async () => {
    const res = await request(app).get("/api/v1/users?limit=100").set(auth(ownerToken));
    expect(res.status).toBe(200);
    const emails = (res.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toContain("owner@nokshi.local");
    expect(emails).toContain("manager@nokshi.local");
    expect(emails).not.toContain("platform@pos.local");
    expect(emails).not.toContain("cashier@other.local");

    const platform = await prisma.user.findUnique({ where: { email: "platform@pos.local" } });
    const other = await prisma.user.findUnique({ where: { email: "cashier@other.local" } });
    const stealPlatform = await request(app).get(`/api/v1/users/${platform!.id}`).set(auth(ownerToken));
    const stealOther = await request(app).get(`/api/v1/users/${other!.id}`).set(auth(ownerToken));
    expect(stealPlatform.status).toBe(404);
    expect(stealOther.status).toBe(404);
  });

  it("Platform super admin can read every tenant's users", async () => {
    const res = await request(app).get("/api/v1/users?limit=100").set(auth(platformToken));
    expect(res.status).toBe(200);
    const emails = (res.body.data as { email: string }[]).map((u) => u.email);
    expect(emails).toContain("platform@pos.local");
    expect(emails).toContain("owner@nokshi.local");
    expect(emails).toContain("cashier@other.local");

    const other = await prisma.user.findUnique({ where: { email: "cashier@other.local" } });
    const getOther = await request(app).get(`/api/v1/users/${other!.id}`).set(auth(platformToken));
    expect(getOther.status).toBe(200);
    expect(getOther.body.data.email).toBe("cashier@other.local");
  });

  it("stock=1 concurrent sales: one win, one INSUFFICIENT_STOCK", async () => {
    await prisma.stock.updateMany({
      where: { tenantId: (await prisma.branch.findUnique({ where: { id: dhk } }))!.tenantId, locationId: dhkLoc, variantId: otherVariant },
      data: { quantity: new Prisma.Decimal(1) },
    });
    const t = Date.now();
    const [a, b] = await Promise.all([
      request(app)
        .post("/api/v1/sales")
        .set(auth(dhkToken))
        .set("Idempotency-Key", `race-a-${t}`)
        .send({
          branchId: dhk,
          registerId: dhkReg,
          deviceId: "DHK-TILL-01",
          clientTransactionId: `race-a-${t}`,
          items: [{ variantId: otherVariant, qty: 1 }],
          payments: [{ method: "CASH", amount: "10000" }],
        }),
      request(app)
        .post("/api/v1/sales")
        .set(auth(dhkToken))
        .set("Idempotency-Key", `race-b-${t}`)
        .send({
          branchId: dhk,
          registerId: dhkReg,
          deviceId: "DHK-TILL-01",
          clientTransactionId: `race-b-${t}`,
          items: [{ variantId: otherVariant, qty: 1 }],
          payments: [{ method: "CASH", amount: "10000" }],
        }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const failed = a.status === 409 ? a : b;
    expect(failed.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("same idempotency key does not duplicate the sale", async () => {
    const key = `idem-${Date.now()}`;
    const tx = `ctx-${Date.now()}`;
    const body = {
      branchId: dhk,
      registerId: dhkReg,
      deviceId: "DHK-TILL-01",
      clientTransactionId: tx,
      items: [{ variantId, qty: 1 }],
      payments: [{ method: "CASH", amount: "10000" }],
    };
    const first = await request(app).post("/api/v1/sales").set(auth(dhkToken)).set("Idempotency-Key", key).send(body);
    const second = await request(app).post("/api/v1/sales").set(auth(dhkToken)).set("Idempotency-Key", key).send(body);
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.meta.replay).toBe(true);
    expect(second.body.data.id ?? second.body.data.invoiceNumber).toBeTruthy();
  });

  it("concurrent sales get unique invoice numbers", async () => {
    const t = Date.now();
    const variants = await request(app).get("/api/v1/catalog/products").set(auth(dhkToken));
    const ids = variants.body.data.flatMap((p: { variants: { id: string }[] }) => p.variants.map((v) => v.id)).slice(2, 6);
    await prisma.stock.updateMany({
      where: { locationId: dhkLoc, variantId: { in: ids } },
      data: { quantity: 20 },
    });
    const results = await Promise.all(
      ids.map((vid: string, i: number) =>
        request(app)
          .post("/api/v1/sales")
          .set(auth(dhkToken))
          .set("Idempotency-Key", `seq-${t}-${i}`)
          .send({
            branchId: dhk,
            registerId: dhkReg,
            deviceId: "DHK-TILL-01",
            clientTransactionId: `seq-${t}-${i}`,
            items: [{ variantId: vid, qty: 1 }],
            payments: [{ method: "CASH", amount: "10000" }],
          }),
      ),
    );
    const invoices = results.filter((r) => r.status === 201).map((r) => r.body.data.invoiceNumber);
    expect(invoices.length, JSON.stringify(results.map((r) => r.body?.error ?? r.status))).toBeGreaterThan(1);
    expect(new Set(invoices).size).toBe(invoices.length);
  });

  it("payment PENDING/FAILED/CANCELLED do not complete the sale or take stock", async () => {
    const before = await prisma.stock.findFirst({
      where: { locationId: dhkLoc, variantId },
    });
    const cases = ["PENDING", "FAILED", "CANCELLED"] as const;
    for (const status of cases) {
      const res = await request(app)
        .post("/api/v1/sales")
        .set(auth(dhkToken))
        .set("Idempotency-Key", `pay-${status}-${Date.now()}`)
        .send({
          branchId: dhk,
          registerId: dhkReg,
          deviceId: "DHK-TILL-01",
          clientTransactionId: `pay-${status}-${Date.now()}`,
          items: [{ variantId, qty: 1 }],
          payments: [{ method: "CARD", amount: "10000", status }],
        });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("DRAFT");
      expect(res.body.data.payments[0].status).toBe(status);
    }
    const after = await prisma.stock.findFirst({
      where: { locationId: dhkLoc, variantId },
    });
    expect(after!.quantity.toString()).toBe(before!.quantity.toString());
  });

  it("CAPTURED cash completes the sale", async () => {
    await prisma.stock.updateMany({
      where: { locationId: dhkLoc, variantId },
      data: { quantity: 10 },
    });
    const res = await request(app)
      .post("/api/v1/sales")
      .set(auth(dhkToken))
      .set("Idempotency-Key", `cap-${Date.now()}`)
      .send({
        branchId: dhk,
        registerId: dhkReg,
        deviceId: "DHK-TILL-01",
        clientTransactionId: `cap-${Date.now()}`,
        items: [{ variantId, qty: 1 }],
        payments: [{ method: "CASH", amount: "10000", status: "CAPTURED" }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.data.status).toBe("COMPLETED");
    expect(res.body.data.payments[0].status).toBe("CAPTURED");
  });

  it("logout revokes the access session", async () => {
    const token = await login("owner@nokshi.local", "Owner123!");
    const out = await request(app).post("/api/v1/auth/logout").set(auth(token));
    expect(out.status).toBe(200);
    const me = await request(app).get("/api/v1/auth/me").set(auth(token));
    expect(me.status).toBe(401);
  });

  it("cookie POST without CSRF is rejected", async () => {
    const signed = await request(app).post("/api/v1/auth/login").send({
      email: "owner@nokshi.local",
      password: "Owner123!",
    });
    expect(signed.status).toBe(200);
    const cookies = signed.headers["set-cookie"];
    const res = await request(app).post("/api/v1/shifts/open").set("Cookie", cookies).send({
      branchId: dhk,
      registerId: dhkReg,
      openingFloat: "10",
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("zero payment amount is rejected", async () => {
    const res = await request(app)
      .post("/api/v1/sales")
      .set(auth(dhkToken))
      .set("Idempotency-Key", `zero-${Date.now()}`)
      .send({
        branchId: dhk,
        registerId: dhkReg,
        deviceId: "DHK-TILL-01",
        clientTransactionId: `zero-${Date.now()}`,
        items: [{ variantId, qty: 1 }],
        payments: [{ method: "CASH", amount: "0" }],
      });
    expect(res.status).toBe(400);
  });
});
