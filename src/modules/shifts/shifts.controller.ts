import type { NextFunction, Request, Response } from "express";
import { ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { shiftsService } from "./shifts.service.js";

/** HTTP-only. */
export const shiftsController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await shiftsService.list(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async current(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await shiftsService.current((req as AuthedRequest).ctx));
    } catch (e) {
      return next(e);
    }
  },

  async open(req: Request, res: Response, next: NextFunction) {
    try {
      const shift = await shiftsService.open(
        (req as AuthedRequest).ctx,
        req.body ?? {},
        (req as AuthedRequest).correlationId,
      );
      return ok(res, shift, undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async close(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await shiftsService.close(
          (req as AuthedRequest).ctx,
          String(req.params.id),
          req.body ?? {},
          (req as AuthedRequest).correlationId,
        ),
      );
    } catch (e) {
      return next(e);
    }
  },
};
