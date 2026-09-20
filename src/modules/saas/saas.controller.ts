import type { NextFunction, Request, Response } from "express";
import { ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { saasService } from "./saas.service.js";

/** HTTP-only. */
export const saasController = {
  async getSubscription(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await saasService.getSubscription((req as AuthedRequest).ctx));
    } catch (e) {
      return next(e);
    }
  },

  async changePlan(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await saasService.changePlan((req as AuthedRequest).ctx, req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async listApiKeys(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await saasService.listApiKeys((req as AuthedRequest).ctx));
    } catch (e) {
      return next(e);
    }
  },

  async createApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await saasService.createApiKey((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async revokeApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await saasService.revokeApiKey((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async createBackup(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await saasService.createBackup((req as AuthedRequest).ctx, req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async listBackups(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await saasService.listBackups(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async downloadBackup(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await saasService.downloadBackup((req as AuthedRequest).ctx, String(req.params.id), req.query as Record<string, unknown>));
    } catch (e) {
      return next(e);
    }
  },
};
