import type { NextFunction, Request, Response } from "express";
import { ok, okList } from "../../utils/response.js";
import type { AuthedRequest } from "../../types.js";
import { financeService } from "./finance.service.js";
import { financeClosingService } from "./finance.closing.service.js";

/** HTTP-only. */
export const financeController = {
  async listExpenseCategories(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await financeService.listExpenseCategories((req as AuthedRequest).ctx));
    } catch (e) {
      return next(e);
    }
  },

  async createExpenseCategory(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await financeService.createExpenseCategory((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async listExpenses(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await financeService.listExpenses(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createExpense(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await financeService.createExpense((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateExpense(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await financeService.updateExpense((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return next(e);
    }
  },

  async deleteExpense(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await financeService.deleteExpense((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async listIncome(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await financeService.listIncome(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createIncome(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await financeService.createIncome((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async updateIncome(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await financeService.updateIncome((req as AuthedRequest).ctx, String(req.params.id), req.body ?? {}),
      );
    } catch (e) {
      return next(e);
    }
  },

  async deleteIncome(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await financeService.deleteIncome((req as AuthedRequest).ctx, String(req.params.id)));
    } catch (e) {
      return next(e);
    }
  },

  async listPayments(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await financeService.listPayments(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createPayment(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(res, await financeService.createPayment((req as AuthedRequest).ctx, req.body ?? {}), undefined, 201);
    } catch (e) {
      return next(e);
    }
  },

  async listCustomerDues(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await financeService.listCustomerDues(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async listSupplierDues(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await financeService.listSupplierDues(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async cashFlow(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await financeClosingService.cashFlow((req as AuthedRequest).ctx, req.query as Record<string, string>),
      );
    } catch (e) {
      return next(e);
    }
  },

  async profitLoss(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await financeClosingService.profitLoss((req as AuthedRequest).ctx, req.query as Record<string, string>),
      );
    } catch (e) {
      return next(e);
    }
  },

  async listDailyClosings(req: Request, res: Response, next: NextFunction) {
    try {
      const { rows, pagination } = await financeClosingService.listDailyClosings(
        (req as AuthedRequest).ctx,
        req.query as Record<string, unknown>,
      );
      return okList(res, rows, pagination);
    } catch (e) {
      return next(e);
    }
  },

  async createDailyClosing(req: Request, res: Response, next: NextFunction) {
    try {
      return ok(
        res,
        await financeClosingService.createDailyClosing((req as AuthedRequest).ctx, req.body ?? {}),
        undefined,
        201,
      );
    } catch (e) {
      return next(e);
    }
  },
};
