import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../lib/prisma.js";
import { createApp } from "../../app.js";
import { ensurePartialIndexes } from "../../lib/ensure-indexes.js";

const app = createApp();

async function login(email: string, password: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.data.accessToken as string;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe("return / receive / damage workflow", () => {
  let owner: string;
  let cashier: string;
  let branchId: string;
  let registerId: string;
  let locationId: string;
  let variantId: string;
  let supplierId: string;

  beforeAll(async () => {
    await ensurePartialIndexes();
    owner = await login("owner@nokshi.local", "Owner123!");
    cashier = await login("cashier.dhk@nokshi.local", "Cashier123!");
    const me = await request(app).get("/api/v1/auth/me").set(auth(owner));
    branchId = me.body.data.branches[0].id;
    registerId = me.body.data.branches[0].registers[0].id;
    locationId = me.body.data.branches[0].locationId;
    const products = await request(app).get("/api/v1/catalog/products").set(auth(owner));
    variantId = products.body.data[0].variants[0].id;
    const suppliers = await request(app).get("/api/v1/suppliers").set(auth(owner));
    supplierId = suppliers.body.data[0]?.id;
    await prisma.stock.updateMany({
      where: { locationId, variantId },
      data: { quantity: 20, reservedQuantity: 0, damagedQuantity: 0, quarantineQuantity: 0 },
    });
    await prisma.shift.updateMany({ where: { status: "OPEN", branchId }, data: { status: "CLOSED", closedAt: new Date() } });
    await request(app).post("/api/v1/shifts/open").set(auth(cashier)).send({
      branchId,
      registerId,
      openingFloat: "100",
    });
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function sell(qty: number) {
    const t = Date.now() + Math.random();
    const res = await request(app)
      .post("/api/v1/sales")
      .set(auth(cashier))
      .set("Idempotency-Key", `wf-sale-${t}`)
      .send({
        branchId,
        registerId,
        deviceId: "DHK-TILL-01",
        clientTransactionId: `wf-${t}`,
        items: [{ variantId, qty }],
        payments: [{ method: "CASH", amount: "10000" }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string; items: { id: string; qty: string }[] };
  }

  async function buckets() {
    const row = await prisma.stock.findFirst({ where: { locationId, variantId } });
    return {
      available: Number(row!.quantity) - Number(row!.reservedQuantity ?? 0),
      damaged: Number(row!.damagedQuantity ?? 0),
      quarantine: Number(row!.quarantineQuantity ?? 0),
    };
  }

  it("partial GOOD return restocks available and keeps the original sale", async () => {
    const sale = await sell(4);
    const before = await buckets();
    const key = `ret-good-${Date.now()}`;
    const ret = await request(app)
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(auth(owner))
      .set("Idempotency-Key", key)
      .send({
        kind: "RETURN",
        reason: "Customer request",
        refundMethod: "CASH",
        items: [{ saleItemId: sale.items[0].id, qty: 2, condition: "GOOD" }],
      });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect(ret.body.data.status).toBe("COMPLETED");
    const after = await buckets();
    expect(after.available).toBe(before.available + 2);
    const replay = await request(app)
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(auth(owner))
      .set("Idempotency-Key", key)
      .send({
        kind: "RETURN",
        reason: "Customer request",
        items: [{ saleItemId: sale.items[0].id, qty: 2, condition: "GOOD" }],
      });
    expect(replay.status).toBe(201);
    expect(replay.body.data.id).toBe(ret.body.data.id);
    const over = await request(app)
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(auth(owner))
      .set("Idempotency-Key", `ret-over-${Date.now()}`)
      .send({
        kind: "RETURN",
        reason: "Too many",
        items: [{ saleItemId: sale.items[0].id, qty: 5, condition: "GOOD" }],
      });
    expect(over.status).toBe(400);
    const invoice = await request(app).get(`/api/v1/sales/${sale.id}`).set(auth(owner));
    expect(invoice.body.data.status).toBe("PARTIALLY_RETURNED");
    expect(invoice.body.data.total).toBeTruthy();
  });

  it("DAMAGED return increases damaged stock, not available", async () => {
    const sale = await sell(3);
    const before = await buckets();
    const ret = await request(app)
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(auth(owner))
      .set("Idempotency-Key", `ret-dmg-${Date.now()}`)
      .send({
        kind: "RETURN",
        reason: "Broken",
        items: [{ saleItemId: sale.items[0].id, qty: 3, condition: "DAMAGED" }],
      });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    const after = await buckets();
    expect(after.available).toBe(before.available);
    expect(after.damaged).toBe(before.damaged + 3);
  });

  it("duplicate refund with the same key does not create a second payment", async () => {
    const sale = await sell(1);
    const ret = await request(app)
      .post(`/api/v1/sales/${sale.id}/returns`)
      .set(auth(cashier))
      .set("Idempotency-Key", `ret-pending-${Date.now()}`)
      .send({
        kind: "RETURN",
        reason: "Customer request",
        items: [{ saleItemId: sale.items[0].id, qty: 1, condition: "GOOD" }],
      });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect(ret.body.data.status).toBe("PENDING");
    const approve = await request(app)
      .post(`/api/v1/sales/returns/${ret.body.data.id}/approve`)
      .set(auth(owner))
      .send({ refund: false });
    expect(approve.status, JSON.stringify(approve.body)).toBe(200);
    const key = `refund-${Date.now()}`;
    const first = await request(app)
      .post(`/api/v1/sales/returns/${ret.body.data.id}/refund`)
      .set(auth(owner))
      .set("Idempotency-Key", key)
      .send({});
    const second = await request(app)
      .post(`/api/v1/sales/returns/${ret.body.data.id}/refund`)
      .set(auth(owner))
      .set("Idempotency-Key", key)
      .send({});
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const payments = await prisma.paymentTransaction.findMany({ where: { saleReturnId: ret.body.data.id } });
    expect(payments.length).toBe(1);
  });

  it("receiving posts stock once and cancel reverses a manual receipt", async () => {
    expect(supplierId).toBeTruthy();
    const before = await buckets();
    const created = await request(app)
      .post("/api/v1/inventory/receipts")
      .set(auth(owner))
      .set("Idempotency-Key", `rcv-${Date.now()}`)
      .send({
        branchId,
        locationId,
        kind: "SUPPLIER",
        supplierId,
        post: false,
        items: [{ variantId, qty: 4, unitCost: 10 }],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.status).toBe("DRAFT");
    const mid = await buckets();
    expect(mid.available).toBe(before.available);
    const id = created.body.data.id;
    const posted = await request(app).post(`/api/v1/inventory/receipts/${id}/receive`).set(auth(owner)).set("Idempotency-Key", `rcv-post-${id}`).send();
    const postedAgain = await request(app).post(`/api/v1/inventory/receipts/${id}/receive`).set(auth(owner)).set("Idempotency-Key", `rcv-post-2-${id}`).send();
    expect(posted.status).toBe(200);
    expect(postedAgain.status).toBe(200);
    const after = await buckets();
    expect(after.available).toBe(before.available + 4);
    const cancelled = await request(app).post(`/api/v1/inventory/receipts/${id}/cancel`).set(auth(owner)).send({ reason: "test" });
    expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    const reversed = await buckets();
    expect(reversed.available).toBe(before.available);
  });

  it("damage does not move stock until approved, then blocks over-qty and unauthorized approve", async () => {
    const before = await buckets();
    const created = await request(app)
      .post("/api/v1/inventory/damages")
      .set(auth(owner))
      .set("Idempotency-Key", `dmg-${Date.now()}`)
      .send({
        branchId,
        locationId,
        reason: "BROKEN",
        description: "Dropped",
        submit: true,
        items: [{ variantId, qty: 2 }],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.data.status).toBe("SUBMITTED");
    const mid = await buckets();
    expect(mid.available).toBe(before.available);
    const forbidden = await request(app).post(`/api/v1/inventory/damages/${created.body.data.id}/approve`).set(auth(cashier)).send();
    expect(forbidden.status).toBe(403);
    const approved = await request(app)
      .post(`/api/v1/inventory/damages/${created.body.data.id}/approve`)
      .set(auth(owner))
      .set("Idempotency-Key", `dmg-ap-${created.body.data.id}`)
      .send();
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const after = await buckets();
    expect(after.available).toBe(before.available - 2);
    expect(after.damaged).toBe(before.damaged + 2);
    const tooMuch = await request(app)
      .post("/api/v1/inventory/damages")
      .set(auth(owner))
      .set("Idempotency-Key", `dmg-over-${Date.now()}`)
      .send({
        branchId,
        locationId,
        reason: "LOST",
        submit: true,
        items: [{ variantId, qty: 99999 }],
      });
    expect(tooMuch.status).toBe(201);
    const approveOver = await request(app)
      .post(`/api/v1/inventory/damages/${tooMuch.body.data.id}/approve`)
      .set(auth(owner))
      .send();
    expect(approveOver.status).toBe(409);
    const cashierLedger = await request(app).get("/api/v1/inventory/movements").set(auth(cashier));
    expect(cashierLedger.status).toBe(403);
  });
});
