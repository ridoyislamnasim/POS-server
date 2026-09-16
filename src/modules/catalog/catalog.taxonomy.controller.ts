import type { NextFunction, Request, Response } from "express";
import { ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { catalogTaxonomyService } from "./catalog.taxonomy.service.js";

function ctxOf(req: Request) {
  return (req as unknown as AuthedRequest).ctx;
}

/** HTTP-only: taxonomy endpoints. */
export const catalogTaxonomyController = {
  async listCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await catalogTaxonomyService.listCategories(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createCategory(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.createCategory(ctxOf(req), req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateCategory(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.updateCategory(ctxOf(req), String(req.params.id), req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async deleteCategory(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.deleteCategory(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async listSubcategories(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await catalogTaxonomyService.listSubcategories(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createSubcategory(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.createSubcategory(ctxOf(req), req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateSubcategory(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.updateSubcategory(ctxOf(req), String(req.params.id), req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async deleteSubcategory(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.deleteSubcategory(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async listBrands(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await catalogTaxonomyService.listBrands(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createBrand(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.createBrand(ctxOf(req), req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateBrand(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.updateBrand(ctxOf(req), String(req.params.id), req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async deleteBrand(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.deleteBrand(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async listUnits(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await catalogTaxonomyService.listUnits(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createUnit(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.createUnit(ctxOf(req), req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateUnit(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.updateUnit(ctxOf(req), String(req.params.id), req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async deleteUnit(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.deleteUnit(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async listAttributes(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await catalogTaxonomyService.listAttributes(ctxOf(req), req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createAttribute(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.createAttribute(ctxOf(req), req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateAttribute(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.updateAttribute(ctxOf(req), String(req.params.id), req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async deleteAttribute(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.deleteAttribute(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async createOption(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await catalogTaxonomyService.createOption(ctxOf(req), String(req.params.id), req.body ?? {}),
        undefined,
        201,
      );
    } catch (e) {
      return next(e);
    }
  },

  async updateOption(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.updateOption(ctxOf(req), String(req.params.id), req.body ?? {}));
    } catch (e) {
      return next(e);
    }
  },

  async deleteOption(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.deleteOption(ctxOf(req), String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async listTaxCategories(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await catalogTaxonomyService.listTaxCategories(ctxOf(req)));
    } catch (e) {
      return next(e);
    }
  },
};
