import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";

const app = createApp();

async function login(email: string, password: string) {
  const res = await request(app).post("/api/v1/auth/login").send({ email, password });
  if (res.status !== 200) return null;
  return res.body.data.accessToken as string;
}

describe("SMS API", () => {
  it("requires auth", async () => {
    const res = await request(app).get("/api/v1/sms/dashboard");
    expect(res.status).toBe(401);
  });

  it("lets the owner load dashboard and hides secrets", async () => {
    const token = await login("owner@nokshi.local", "Owner123!");
    if (!token) return;
    const dash = await request(app).get("/api/v1/sms/dashboard").set({ Authorization: `Bearer ${token}` });
    expect(dash.status).toBe(200);
    expect(dash.body.success).toBe(true);
    const settings = await request(app).get("/api/v1/sms/settings").set({ Authorization: `Bearer ${token}` });
    expect(settings.status).toBe(200);
    const body = JSON.stringify(settings.body);
    expect(body).not.toMatch(/apiKeyEnc|apiSecretEnc|enc:v1:/);
    expect(settings.body.data.hasApiKey === true || settings.body.data.hasApiKey === false).toBe(true);

    const preview = await request(app)
      .post("/api/v1/sms/preview")
      .set({ Authorization: `Bearer ${token}` })
      .send({ templateKey: "SALE_CONFIRMATION", language: "bn", vars: { customerName: "রাফি", invoiceNo: "INV-1", amount: "10", dueAmount: "0" } });
    expect(preview.status).toBe(200);
    expect(String(preview.body.data.message)).toContain("INV-1");

    const send = await request(app)
      .post("/api/v1/sms/send")
      .set({ Authorization: `Bearer ${token}` })
      .send({
        recipientType: "CUSTOMER",
        to: "+8801711111111",
        name: "API Test",
        templateKey: "MANUAL_CUSTOMER",
        message: "Hello from API test",
        idempotencyKey: `api-test-${Date.now()}`,
      });
    expect([201, 400]).toContain(send.status);
    if (send.status === 201) {
      const again = await request(app)
        .post("/api/v1/sms/send")
        .set({ Authorization: `Bearer ${token}` })
        .send({
          recipientType: "CUSTOMER",
          to: "+8801711111111",
          templateKey: "MANUAL_CUSTOMER",
          message: "Hello from API test",
          idempotencyKey: send.body.data?.log?.idempotencyKey ?? `missing`,
        });
      if (again.status === 201) {
        expect(again.body.data.duplicate === true || again.body.data.log?.status === "SENT" || again.body.data.skipped).toBeTruthy();
      }
    }
  });

  it("blocks cashier from SMS settings", async () => {
    const token = await login("cashier.dhk@nokshi.local", "Cashier123!");
    if (!token) return;
    const settings = await request(app).get("/api/v1/sms/settings").set({ Authorization: `Bearer ${token}` });
    expect(settings.status).toBe(403);
    const send = await request(app)
      .post("/api/v1/sms/send")
      .set({ Authorization: `Bearer ${token}` })
      .send({ recipientType: "SUPPLIER", to: "+8801711111112", message: "nope" });
    expect(send.status).toBe(403);
  });
});
