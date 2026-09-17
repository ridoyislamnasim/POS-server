import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../app.js";

const app = createApp();

describe("CORS multiple origins", () => {
  it("OPTIONS preflight returns 204 and Access-Control-Allow-Origin for allowed origin", async () => {
    const res = await request(app)
      .options("/api/v1/auth/login")
      .set("Origin", "https://shohojhisab.com")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("https://shohojhisab.com");
  });

  it("POST login from allowed origin includes Access-Control-Allow-Origin", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "https://shohojhisab.com")
      .send({ email: "owner@nokshi.local", password: "Owner123!" });
    expect(res.headers["access-control-allow-origin"]).toBe("https://shohojhisab.com");
  });

  it("blocked origin does not include Access-Control-Allow-Origin", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "https://evil.com")
      .send({ email: "owner@nokshi.local", password: "Owner123!" });
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("all comma-separated origins pass preflight", async () => {
    const origins = [
      "http://localhost:3020",
      "https://shohojhisab.com",
      "https://mobile.shohojhisab.com",
    ];
    for (const origin of origins) {
      const res = await request(app)
        .options("/api/v1/auth/login")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST");
      expect(res.status).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(origin);
    }
  });
});
