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

describe("document print / pdf security", () => {
  let owner: string;
  let cashier: string;
  let other: string;
  let branchId: string;
  let registerId: string;
  let variantId: string;

  beforeAll(async () => {
    await ensurePartialIndexes();
    owner = await login("owner@nokshi.local", "Owner123!");
    cashier = await login("cashier.dhk@nokshi.local", "Cashier123!");
    other = await login("cashier.utt@nokshi.local", "Cashier123!");
    const me = await request(app).get("/api/v1/auth/me").set(auth(owner));
    branchId = me.body.data.branches[0].id;
    registerId = me.body.data.branches[0].registers[0].id;
    const products = await request(app).get("/api/v1/catalog/products").set(auth(owner));
    variantId = products.body.data[0].variants[0].id;
    await prisma.shift.updateMany({ where: { status: "OPEN", branchId }, data: { status: "CLOSED", closedAt: new Date() } });
    await request(app).post("/api/v1/shifts/open").set(auth(cashier)).send({ branchId, registerId, openingFloat: "100" });
  }, 60000);

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function sell() {
    const t = Date.now() + Math.random();
    const res = await request(app)
      .post("/api/v1/sales")
      .set(auth(cashier))
      .set("Idempotency-Key", `doc-sale-${t}`)
      .send({
        branchId,
        registerId,
        deviceId: "DHK-TILL-01",
        clientTransactionId: `doc-${t}`,
        items: [{ variantId, qty: 1 }],
        payments: [{ method: "CASH", amount: "10000" }],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.data as { id: string; invoiceNumber: string };
  }

  it("prints html receipt and downloads a4 pdf with invoice filename", async () => {
    const sale = await sell();
    const html = await request(app).get(`/api/v1/documents/sale/${sale.id}/print`).set(auth(cashier));
    expect(html.status).toBe(200);
    expect(html.headers["content-type"]).toMatch(/html/);
    expect(html.text).toContain(sale.invoiceNumber);
    expect(html.text).toContain("@page");
    expect(html.text).toMatch(/58mm auto|80mm auto/);
    const a4 = await request(app).get(`/api/v1/documents/sale/${sale.id}/print?layout=invoice`).set(auth(cashier));
    expect(a4.status).toBe(200);
    expect(a4.text).toContain("size: A4");
    expect(a4.text).not.toMatch(/58mm auto|80mm auto/);
    const pdf = await request(app).get(`/api/v1/documents/sale/${sale.id}.pdf`).set(auth(cashier));
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
    expect(pdf.headers["content-disposition"]).toContain(`${sale.invoiceNumber}.pdf`);
    expect(pdf.body.toString("utf8", 0, 4)).toBe("%PDF");
    const legacy = await request(app).get(`/api/v1/sales/${sale.id}/documents/invoice.pdf`).set(auth(cashier));
    expect(legacy.status).toBe(200);
  });

  it("blocks other tenant from print and pdf", async () => {
    const sale = await sell();
    const html = await request(app).get(`/api/v1/documents/sale/${sale.id}/print`).set(auth(other));
    expect(html.status).toBe(403);
    const pdf = await request(app).get(`/api/v1/documents/sale/${sale.id}.pdf`).set(auth(other));
    expect(pdf.status).toBe(403);
  });

  it("rejects unauthenticated document access", async () => {
    const res = await request(app).get(`/api/v1/documents/sale/does-not-exist.pdf`);
    expect(res.status).toBe(401);
  });
});
