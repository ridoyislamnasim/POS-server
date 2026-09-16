import type { NextFunction, Request, Response } from "express";
import { ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { suppliersService } from "./suppliers.service.js";

/** HTTP-only. */
export const suppliersController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await suppliersService.list(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await suppliersService.getById((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await suppliersService.create((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await suppliersService.update((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return next(e);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await suppliersService.remove((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },
};
