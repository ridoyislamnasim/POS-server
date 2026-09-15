import { Router, type Request } from "express";
import { prisma } from "../../lib/prisma.js";
import { fail, ok, okList } from "../../lib/envelope.js";
import { requireAuth, requirePermission, requirePlatform } from "../../middleware/auth.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";
import {
  createPlan,
  updatePlan,
  getPlanWithLimitsAndFeatures,
  listPlans,
  setPlanLimits,
  setPlanFeatures,
  getFeatureComparison,
} from "./plan.service.js";

export const planRouter = Router();
planRouter.use(requireAuth, requirePlatform, requirePermission("plan.manage"));

function ctxOf(req: Request) {
  return (req as AuthedRequest).ctx;
}

// List all plans with limits and features
planRouter.get("/", async (_req, res) => {
  const plans = await listPlans();
  return ok(res, plans);
});

// Create plan
planRouter.post("/", async (req, res) => {
  const ctx = ctxOf(req);
  const { code, name, description, interval, price, yearlyPrice, currency, displayOrder } = req.body ?? {};
  if (!code || !name) return fail(res, "VALIDATION", "code and name required");

  const existing = await prisma.plan.findUnique({ where: { code: String(code).toUpperCase() } });
  if (existing) return fail(res, "CONFLICT", "A plan with this code already exists");

  const plan = await createPlan({ code, name, description, interval, price, yearlyPrice, currency, displayOrder });
  await writeAudit({ ctx, action: "plan.create", entityType: "Plan", entityId: plan.id, after: { code: plan.code, name: plan.name } });
  return ok(res, plan, undefined, 201);
});

// Update plan metadata
planRouter.patch("/:id", async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = req.params;
  const existing = await prisma.plan.findUnique({ where: { id } });
  if (!existing) return fail(res, "NOT_FOUND", "Plan not found", 404);

  const data: Record<string, unknown> = {};
  if (req.body?.name !== undefined) data.name = req.body.name;
  if (req.body?.description !== undefined) data.description = req.body.description;
  if (req.body?.interval !== undefined) data.interval = req.body.interval;
  if (req.body?.price !== undefined) data.price = req.body.price;
  if (req.body?.yearlyPrice !== undefined) data.yearlyPrice = req.body.yearlyPrice;
  if (req.body?.currency !== undefined) data.currency = req.body.currency;
  if (req.body?.active !== undefined) data.active = req.body.active;
  if (req.body?.displayOrder !== undefined) data.displayOrder = req.body.displayOrder;

  const plan = await updatePlan(id, data);
  await writeAudit({ ctx, action: "plan.update", entityType: "Plan", entityId: id, before: { name: existing.name, price: existing.price }, after: data });
  return ok(res, plan);
});

// Get plan limits
planRouter.get("/:id/limits", async (req, res) => {
  const plan = await getPlanWithLimitsAndFeatures(req.params.id);
  if (!plan) return fail(res, "NOT_FOUND", "Plan not found", 404);
  return ok(res, plan.planLimits);
});

// Bulk update plan limits
planRouter.patch("/:id/limits", async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = req.params;
  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) return fail(res, "NOT_FOUND", "Plan not found", 404);

  const limits = req.body?.limits;
  if (!Array.isArray(limits)) return fail(res, "VALIDATION", "limits array required");

  await setPlanLimits(id, limits);
  await writeAudit({ ctx, action: "plan.limit.update", entityType: "Plan", entityId: id, after: { limits } });

  const updated = await getPlanWithLimitsAndFeatures(id);
  return ok(res, updated?.planLimits ?? []);
});

// Get plan features
planRouter.get("/:id/features", async (req, res) => {
  const plan = await getPlanWithLimitsAndFeatures(req.params.id);
  if (!plan) return fail(res, "NOT_FOUND", "Plan not found", 404);
  return ok(res, plan.planFeatures);
});

// Bulk update plan features
planRouter.patch("/:id/features", async (req, res) => {
  const ctx = ctxOf(req);
  const { id } = req.params;
  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) return fail(res, "NOT_FOUND", "Plan not found", 404);

  const features = req.body?.features;
  if (!Array.isArray(features)) return fail(res, "VALIDATION", "features array required");

  await setPlanFeatures(id, features);
  await writeAudit({ ctx, action: "plan.feature.update", entityType: "Plan", entityId: id, after: { features } });

  const updated = await getPlanWithLimitsAndFeatures(id);
  return ok(res, updated?.planFeatures ?? []);
});

// Feature comparison matrix
planRouter.get("/comparison", async (_req, res) => {
  const comparison = await getFeatureComparison();
  return ok(res, comparison);
});
