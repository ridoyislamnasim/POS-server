import type { NextFunction, Request, Response } from "express";
import { fail, ok } from "../../utils/response.js";
import { writeAudit } from "../../lib/audit.js";
import type { AuthedRequest } from "../../types.js";
import { planRepository } from "./plan.repository.js";
import {
  createPlan,
  updatePlan,
  getPlanWithLimitsAndFeatures,
  listPlans,
  setPlanLimits,
  setPlanFeatures,
  getFeatureComparison,
  type PlanFeatureInput,
  type PlanLimitInput,
} from "./plan.service.js";

/** Express 5 types `req.params.*` as `string | string[]`; single-segment route params are strings at runtime. */
function paramId(req: Request): string {
  return req.params.id as string;
}

/** HTTP-only. */
export const planController = {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await listPlans());
    } catch (e) {
      return next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = (req as AuthedRequest).ctx;
      const { code, name, description, interval, price, yearlyPrice, currency, displayOrder } = req.body ?? {};
      if (!code || !name) return fail(res, "VALIDATION", "code and name required");
      const existing = await planRepository.findByCode(String(code));
      if (existing) return fail(res, "CONFLICT", "A plan with this code already exists");
      const plan = await createPlan({ code, name, description, interval, price, yearlyPrice, currency, displayOrder });
      await writeAudit({ ctx, action: "plan.create", entityType: "Plan", entityId: plan.id, after: { code: plan.code, name: plan.name } });
      return ok(res, plan, undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = (req as AuthedRequest).ctx;
      const id = paramId(req);
      const existing = await planRepository.findById(id);
      if (!existing) return fail(res, "NOT_FOUND", "Plan not found", 404);
      const data: Record<string, unknown> = {};
      if (req.body?.code !== undefined) data.code = String(req.body.code).toUpperCase();
      if (req.body?.name !== undefined) data.name = req.body.name;
      if (req.body?.description !== undefined) data.description = req.body.description;
      if (req.body?.interval !== undefined) data.interval = req.body.interval;
      if (req.body?.price !== undefined) data.price = req.body.price;
      if (req.body?.yearlyPrice !== undefined) data.yearlyPrice = req.body.yearlyPrice;
      if (req.body?.currency !== undefined) data.currency = req.body.currency;
      if (req.body?.active !== undefined) data.active = req.body.active;
      if (req.body?.displayOrder !== undefined) data.displayOrder = req.body.displayOrder;
      const plan = await updatePlan(id, data as Parameters<typeof updatePlan>[1]);
      await writeAudit({ ctx, action: "plan.update", entityType: "Plan", entityId: id, before: { name: existing.name, price: existing.price }, after: data });
      return ok(res, plan);
    } catch (e) {
      return next(e);
    }
  },

  async comparison(_req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await getFeatureComparison());
    } catch (e) {
      return next(e);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const plan = await getPlanWithLimitsAndFeatures(paramId(req));
      if (!plan) return fail(res, "NOT_FOUND", "Plan not found", 404);
      return ok(res, plan);
    } catch (e) {
      return next(e);
    }
  },

  async listLimits(req: Request, res: Response, next: NextFunction) {
    try {
      const plan = await getPlanWithLimitsAndFeatures(paramId(req));
      if (!plan) return fail(res, "NOT_FOUND", "Plan not found", 404);
      return ok(res, plan.planLimits);
    } catch (e) {
      return next(e);
    }
  },

  async setLimits(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = (req as AuthedRequest).ctx;
      const id = paramId(req);
      const plan = await planRepository.findById(id);
      if (!plan) return fail(res, "NOT_FOUND", "Plan not found", 404);
      const limits = req.body?.limits;
      if (!Array.isArray(limits)) return fail(res, "VALIDATION", "limits array required");
      await setPlanLimits(id, limits as PlanLimitInput[]);
      await writeAudit({ ctx, action: "plan.limit.update", entityType: "Plan", entityId: id, after: { limits } });
      const updated = await getPlanWithLimitsAndFeatures(id);
      return ok(res, updated?.planLimits ?? []);
    } catch (e) {
      return next(e);
    }
  },

  async listFeatures(req: Request, res: Response, next: NextFunction) {
    try {
      const plan = await getPlanWithLimitsAndFeatures(paramId(req));
      if (!plan) return fail(res, "NOT_FOUND", "Plan not found", 404);
      return ok(res, plan.planFeatures);
    } catch (e) {
      return next(e);
    }
  },

  async setFeatures(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = (req as AuthedRequest).ctx;
      const id = paramId(req);
      const plan = await planRepository.findById(id);
      if (!plan) return fail(res, "NOT_FOUND", "Plan not found", 404);
      const features = req.body?.features;
      if (!Array.isArray(features)) return fail(res, "VALIDATION", "features array required");
      await setPlanFeatures(id, features as PlanFeatureInput[]);
      await writeAudit({ ctx, action: "plan.feature.update", entityType: "Plan", entityId: id, after: { features } });
      const updated = await getPlanWithLimitsAndFeatures(id);
      return ok(res, updated?.planFeatures ?? []);
    } catch (e) {
      return next(e);
    }
  },
};
