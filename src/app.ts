import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { prisma } from "./lib/prisma.js";
import { fail, ok } from "./lib/envelope.js";
import { pingRedis, redisRequired } from "./lib/redis.js";
import { requestContext } from "./middleware/request-id.js";
import { csrfProtect } from "./middleware/csrf.js";
import { errorMiddleware, notFoundMiddleware } from "./middleware/error.middleware.js";
import { registerRoutes } from "./app/routes.js";
import { env } from "./config/env.js";
import { BUILD_SHA, BUILD_TIME } from "./generated/build-info.js";

const originAllowlist = env.allowedFrontendOrigins;

export function createApp() {
  const app = express();
  app.use(requestContext);
  app.use(
    cors({
      origin: originAllowlist,
      credentials: true,
      exposedHeaders: ["Content-Disposition"],
    }),
  );
  app.use(express.json({ limit: "12mb" }));
  app.use(cookieParser());
  app.use(csrfProtect);
  const uploadRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads");
  app.use("/uploads", express.static(uploadRoot, { index: false, dotfiles: "deny" }));

  app.get("/api/health", (_req, res) => ok(res, { status: "ok" }));
  // Public build fingerprint — proves which commit is actually live.
  // Used by the deploy workflow to fail loudly on stale pm2 processes.
  // no-store: proxies must never cache this (a cached 404 would hide deploys).
  app.get("/api/version", (_req, res) => {
    res.set("Cache-Control", "no-store");
    return ok(res, { version: BUILD_SHA, builtAt: BUILD_TIME });
  });
  app.get("/api/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      return fail(res, "NOT_READY", "PostgreSQL unavailable", 503);
    }
    const redisOk = await pingRedis();
    if (redisRequired() && !redisOk) {
      return fail(res, "NOT_READY", "Redis unavailable", 503);
    }
    return ok(res, { db: true, redis: redisOk });
  });

  registerRoutes(app);

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);
  return app;
}
