import type { NextFunction, Request, Response } from "express";
import { ok } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { settingsService } from "./settings.service.js";

/** HTTP-only. */
export const settingsController = {
  async get(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await settingsService.get((req as AuthedRequest).ctx));
    } catch (e) {
      return next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await settingsService.update((req as AuthedRequest).ctx, req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async createTax(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await settingsService.createTax((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async createTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await settingsService.createTemplate((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async listCurrencies(_req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await settingsService.listCurrencies());
    } catch (e) {
      return next(e);
    }
  },

  async createCurrency(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await settingsService.createCurrency((req as AuthedRequest).ctx, req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },
};
