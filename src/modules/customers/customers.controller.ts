import type { NextFunction, Request, Response } from "express";
import { fail, ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { customersService, canLookupCustomers, canWriteCustomers } from "./customers.service.js";

/** HTTP-only: permission gates + param extraction + response writing. */
export const customersController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = (req as AuthedRequest).ctx;
      if (!canLookupCustomers(ctx)) return fail(res, "FORBIDDEN", "Missing permission", 403);
      const phone = req.query.phone ? String(req.query.phone) : "";
      if (phone) return ok(res, await customersService.findByPhone(ctx, phone));
      if (!ctx.isPlatform && !ctx.roles.includes("TENANT_OWNER") && !ctx.permissions.includes("customer.view")) {
        return fail(res, "FORBIDDEN", "Missing permission", 403);
      }
      const { rows, pagination } = await customersService.list(ctx, req.query as Record<string, unknown>);
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async search(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = (req as AuthedRequest).ctx;
      if (!canLookupCustomers(ctx)) return fail(res, "FORBIDDEN", "Missing permission", 403);
      return ok(
        res,
        await customersService.search(ctx, req.query.q ? String(req.query.q) : undefined, req.query.limit),
      );
    } catch (e) {
      return next(e);
    }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await customersService.getDetail((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const ctx = (req as AuthedRequest).ctx;
      if (!canWriteCustomers(ctx)) return fail(res, "FORBIDDEN", "Missing permission", 403);
      return ok(res, await customersService.create(ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await customersService.update((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return next(e);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await customersService.remove((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async adjustLoyalty(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await customersService.adjustLoyalty((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
        undefined,
        201,
      );
    } catch (e) {
      return next(e);
    }
  },
};
