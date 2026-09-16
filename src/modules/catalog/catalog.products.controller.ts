import type { NextFunction, Request, Response } from "express";
import { ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { catalogProductsService } from "./catalog.products.service.js";

function ctxOf(req: Request) {
  return (req as unknown as AuthedRequest).ctx;
}

/** HTTP-only: product/variant/barcode endpoints. */
export const catalogProductsController = {
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogProductsService.upload(String((req.body ?? {}).dataUrl ?? "")), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async listProducts(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await catalogProductsService.listProducts(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async listVariants(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await catalogProductsService.listVariants(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async lookupBarcode(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogProductsService.lookupBarcode(ctxOf(req), String(req.params.code)));
    } catch (e) {
      return next(e);
    }
  },

  async matrix(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogProductsService.matrix(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async getProduct(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogProductsService.getProduct(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async createProduct(req: Request, res: Response, next: NextFunction) {
    try {
      const full = await catalogProductsService.createProduct(
        ctxOf(req),
        (req.body ?? {}) as Record<string, unknown>,
        (req as unknown as AuthedRequest).correlationId,
      );
      return ok(res, full, undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateProduct(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await catalogProductsService.updateProduct(ctxOf(req), String(req.params.id), (req.body ?? {}) as Record<string, unknown>),
      );
    } catch (e) {
      return next(e);
    }
  },

  async archiveProduct(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await catalogProductsService.archiveProduct(
          ctxOf(req),
          String(req.params.id),
          (req as unknown as AuthedRequest).correlationId,
        ),
      );
    } catch (e) {
      return next(e);
    }
  },

  async generateVariants(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await catalogProductsService.generateVariants(
          ctxOf(req),
          String(req.params.id),
          (req.body ?? {}) as Record<string, unknown>,
        ),
      );
    } catch (e) {
      return next(e);
    }
  },

  async patchVariant(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await catalogProductsService.patchVariant(ctxOf(req), String(req.params.id), (req.body ?? {}) as Record<string, unknown>),
      );
    } catch (e) {
      return next(e);
    }
  },

  async deleteVariant(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogProductsService.deleteVariant(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async addBarcode(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await catalogProductsService.addBarcode(ctxOf(req), String(req.params.id), (req.body ?? {}) as { code: string; kind?: string; primary?: boolean }),
        undefined,
        201,
      );
    } catch (e) {
      return next(e);
    }
  },
};
