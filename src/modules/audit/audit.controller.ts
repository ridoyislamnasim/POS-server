import type { NextFunction, Request, Response } from "express";
import { okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { auditService } from "./audit.service.js";

/** HTTP-only. */
export const auditController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await auditService.list(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },
};
