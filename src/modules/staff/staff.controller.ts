import type { NextFunction, Request, Response } from "express";
import { ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { staffService } from "./staff.service.js";

/** HTTP-only. */
export const staffController = {
  async listPermissions(_req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, staffService.listPermissions());
    } catch (e) {
      return next(e);
    }
  },

  async listRoles(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await staffService.listRoles(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async updateRole(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await staffService.updateRole((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return next(e);
    }
  },

  async listAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await staffService.listAttendance(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await staffService.createAttendance((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async deleteAttendance(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await staffService.deleteAttendance((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async listShiftTemplates(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await staffService.listShiftTemplates((req as AuthedRequest).ctx));
    } catch (e) {
      return next(e);
    }
  },

  async createShiftTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await staffService.createShiftTemplate((req as AuthedRequest).ctx, req.body ?? {}),
        undefined,
        201,
      );
    } catch (e) {
      return next(e);
    }
  },

  async listLogins(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await staffService.listLoginAttempts(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async listSessions(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await staffService.listSessions(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async revokeSession(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await staffService.revokeSession((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },
};
