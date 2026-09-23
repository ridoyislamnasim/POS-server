import type { NextFunction, Request, Response } from "express";
import { ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { commerceService } from "./commerce.service.js";

/** HTTP-only. */
export const commerceController = {
  async listSalesOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await commerceService.listSalesOrders(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async getSalesOrder(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await commerceService.getSalesOrder((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async createSalesOrder(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await commerceService.createSalesOrder((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateSalesOrder(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await commerceService.updateSalesOrder((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return next(e);
    }
  },

  async duplicateSalesOrder(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await commerceService.duplicateSalesOrder((req as AuthedRequest).ctx, String(req.params.id)), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async convertSalesOrder(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await commerceService.convertSalesOrder((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async linkConvertedSale(req: Request, res: Response, next: NextFunction) {
    try {
      const { saleId } = req.body ?? {};
      if (!saleId) throw Object.assign(new Error("saleId required"), { code: "VALIDATION", status: 400 });
      return ok(res, await commerceService.linkConvertedSale((req as AuthedRequest).ctx, String(req.params.id), String(saleId)));
    } catch (e) {
      return next(e);
    }
  },

  async listEcommerceOrders(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await commerceService.listEcommerceOrders(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async upsertEcommerceOrder(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await commerceService.upsertEcommerceOrder((req as AuthedRequest).ctx, req.body ?? {}),
        undefined,
        201,
      );
    } catch (e) {
      return next(e);
    }
  },

  async deleteEcommerceOrder(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await commerceService.deleteEcommerceOrder((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async listDeliveries(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await commerceService.listDeliveries(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createDelivery(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await commerceService.createDelivery((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateDelivery(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await commerceService.updateDelivery((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return next(e);
    }
  },

  async deleteDelivery(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await commerceService.deleteDelivery((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },
};
