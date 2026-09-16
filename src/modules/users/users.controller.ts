import type { NextFunction, Request, Response } from "express";
import { ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { usersService } from "./users.service.js";

/** HTTP-only: extract req data, call the service, write the response. */
export const usersController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await usersService.list(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await usersService.create((req as AuthedRequest).ctx, req.body ?? {});
      return ok(res, result, undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async listRoles(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await usersService.listRoles((req as AuthedRequest).ctx));
    } catch (e) {
      return next(e);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await usersService.getById((req as AuthedRequest).ctx, String(req.params.id)),
      );
    } catch (e) {
      return next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await usersService.update((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return next(e);
    }
  },

  async deactivate(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await usersService.deactivate((req as AuthedRequest).ctx, String(req.params.id)),
      );
    } catch (e) {
      return next(e);
    }
  },
};
