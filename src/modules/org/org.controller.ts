import type { NextFunction, Request, Response } from "express";
import { ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { orgService } from "./org.service.js";

/** HTTP-only. */
export const orgController = {
  async getBusiness(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await orgService.getBusiness((req as AuthedRequest).ctx));
    } catch (e) {
      return next(e);
    }
  },

  async updateBusiness(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await orgService.updateBusiness((req as AuthedRequest).ctx, req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async listBranches(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await orgService.listBranches(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createBranch(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await orgService.createBranch((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateBranch(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await orgService.updateBranch((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return next(e);
    }
  },

  async deleteBranch(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await orgService.deleteBranch((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async listWarehouses(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await orgService.listWarehouses(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await orgService.createWarehouse((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await orgService.updateWarehouse((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return next(e);
    }
  },

  async deleteWarehouse(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await orgService.deleteWarehouse((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },
};
