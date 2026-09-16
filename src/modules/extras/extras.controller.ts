import type { NextFunction, Request, Response } from "express";
import { ok } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { extrasService } from "./extras.service.js";

/** HTTP-only. */
export const extrasController = {
  async generateBarcodes(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, extrasService.generateBarcodes(req.query as Record<string, string>));
    } catch (e) {
      return next(e);
    }
  },

  async importProducts(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await extrasService.importProducts((req as AuthedRequest).ctx, req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async importCustomers(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await extrasService.importCustomers((req as AuthedRequest).ctx, req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async exportData(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await extrasService.exportData((req as AuthedRequest).ctx, req.query as Record<string, string>),
      );
    } catch (e) {
      return next(e);
    }
  },
};
