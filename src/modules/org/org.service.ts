import { writeAudit } from "../../lib/audit.js";
import { planLimits, tenantId } from "../../lib/erp.js";
import { ilike, parseListQuery, withPagination } from "../../lib/list-query.js";
import { AppError } from "../../utils/errors.js";
import type { RequestContext } from "../../types.js";
import { orgRepository } from "./org.repository.js";
import type {
  CreateBranchInput,
  CreateWarehouseInput,
  UpdateBranchInput,
  UpdateBusinessInput,
  UpdateWarehouseInput,
} from "./org.types.js";

/** Org business logic. No Express `req`/`res` here. */
export const orgService = {
  async getBusiness(ctx: RequestContext) {
    const tid = tenantId(ctx);
    const [business, tenant] = await Promise.all([
      orgRepository.findBusiness(tid),
      orgRepository.findTenantWithPlan(tid),
    ]);
    return { business, tenant };
  },

  async updateBusiness(ctx: RequestContext, input: UpdateBusinessInput) {
    const tid = tenantId(ctx);
    const existing = await orgRepository.findBusiness(tid);
    const { tenantName: _tenantName, ...data } = input;
    const row = await orgRepository.upsertBusiness(tid, existing?.id ?? null, { ...data });
    if (input.tenantName) {
      await orgRepository.renameTenant(tid, String(input.tenantName));
    }
    await writeAudit({ ctx, action: "business.update", entityType: "Business", entityId: row.id });
    return row;
  },

  async listBranches(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, { sortable: ["name", "code"], defaultSort: "name", defaultOrder: "asc" });
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      ...(q ? { OR: [{ name: ilike(q) }, { code: ilike(q) }] } : {}),
    };
    return withPagination(list, {
      find: (skip, take) =>
        orgRepository.listBranches({
          where,
          skip,
          take,
          orderBy: list.sortBy === "code" ? { code: list.sortOrder } : { name: list.sortOrder },
        }),
      count: () => orgRepository.countBranches(tenantId(ctx)),
    });
  },

  async createBranch(ctx: RequestContext, input: CreateBranchInput) {
    const { name, code, type, timezone, negativeStockPolicy } = input;
    if (!name || !code) throw new AppError("VALIDATION", "name and code required", 400);
    const { limits } = await planLimits(ctx);
    const count = await orgRepository.countBranches(tenantId(ctx));
    if (limits.maxBranches && count >= limits.maxBranches) {
      throw new AppError("PLAN_LIMIT", `Plan allows ${limits.maxBranches} branches`, 402);
    }
    const loc = await orgRepository.createLocation({
      tenantId: tenantId(ctx),
      type: type === "WAREHOUSE" ? "WAREHOUSE" : "STORE",
      name: `${name} Floor`,
    });
    await orgRepository.createLocationChannel({
      tenantId: tenantId(ctx),
      locationId: loc.id,
      channel: "STORE",
    });
    const branch = await orgRepository.createBranch({
      tenantId: tenantId(ctx),
      locationId: loc.id,
      name,
      code: String(code).toUpperCase(),
      timezone: timezone ?? "Asia/Dhaka",
      negativeStockPolicy: (negativeStockPolicy as "BLOCK" | "ALLOW") ?? "BLOCK",
    });
    await orgRepository.createRegister({
      tenantId: tenantId(ctx),
      branchId: branch.id,
      name: "Register 01",
    });
    const year = new Date().getFullYear();
    await orgRepository.createSequence({
      tenantId: tenantId(ctx),
      branchId: branch.id,
      documentType: "INVOICE",
      fiscalYear: year,
      prefix: `${branch.code}-INV-${year}-`,
    });
    return branch;
  },

  async updateBranch(ctx: RequestContext, id: string, input: UpdateBranchInput) {
    const existing = await orgRepository.findBranch(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Branch not found", 404);
    return orgRepository.updateBranch(existing.id, {
      name: input.name,
      operationalStatus: input.operationalStatus,
      timezone: input.timezone,
      negativeStockPolicy: input.negativeStockPolicy,
    });
  },

  async deleteBranch(ctx: RequestContext, id: string) {
    const existing = await orgRepository.findBranchWithCounts(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Branch not found", 404);
    if (existing._count.sales > 0) {
      throw new AppError("CONFLICT", "This branch has sales and cannot be deleted", 409);
    }
    if (existing._count.userBranches > 0) {
      throw new AppError("CONFLICT", "Remove assigned users from this branch first", 409);
    }
    const registers = await orgRepository.listRegisters(existing.id);
    const registerIds = registers.map((r) => r.id);
    if (registerIds.length && ((await orgRepository.countShifts(registerIds)) > 0)) {
      throw new AppError("CONFLICT", "This branch has shift history and cannot be deleted", 409);
    }
    await orgRepository.deleteBranchCascade(existing.id, registerIds);
    await writeAudit({
      ctx,
      action: "branch.delete",
      entityType: "Branch",
      entityId: existing.id,
      before: { name: existing.name },
    });
    return { id: existing.id };
  },

  async listWarehouses(ctx: RequestContext, query: Record<string, unknown>) {
    const list = parseListQuery(query, { sortable: ["name"], defaultSort: "name", defaultOrder: "asc" });
    const q = list.search;
    const where = {
      tenantId: tenantId(ctx),
      type: "WAREHOUSE" as const,
      ...(q ? { name: ilike(q) } : {}),
    };
    return withPagination(list, {
      find: (skip, take) => orgRepository.listWarehouses({ where, skip, take, order: list.sortOrder }),
      count: () => orgRepository.countWarehouses(tenantId(ctx)),
    });
  },

  async createWarehouse(ctx: RequestContext, input: CreateWarehouseInput) {
    if (!input.name) throw new AppError("VALIDATION", "name required", 400);
    const { limits } = await planLimits(ctx);
    const count = await orgRepository.countWarehouses(tenantId(ctx));
    if (limits.maxWarehouses && count >= limits.maxWarehouses) {
      throw new AppError("PLAN_LIMIT", `Plan allows ${limits.maxWarehouses} warehouses`, 402);
    }
    const loc = await orgRepository.createLocation({
      tenantId: tenantId(ctx),
      type: "WAREHOUSE",
      name: input.name,
    });
    await orgRepository.createLocationChannel({
      tenantId: tenantId(ctx),
      locationId: loc.id,
      channel: "WAREHOUSE",
    });
    return loc;
  },

  async updateWarehouse(ctx: RequestContext, id: string, input: UpdateWarehouseInput) {
    const existing = await orgRepository.findWarehouse(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Warehouse not found", 404);
    return orgRepository.updateWarehouse(existing.id, input.name);
  },

  async deleteWarehouse(ctx: RequestContext, id: string) {
    const existing = await orgRepository.findWarehouseWithStock(tenantId(ctx), id);
    if (!existing) throw new AppError("NOT_FOUND", "Warehouse not found", 404);
    if (existing._count.stock > 0) {
      throw new AppError("CONFLICT", "This warehouse still has stock", 409);
    }
    await orgRepository.deleteWarehouse(existing.id);
    await writeAudit({
      ctx,
      action: "warehouse.delete",
      entityType: "Location",
      entityId: existing.id,
      before: { name: existing.name },
    });
    return { id: existing.id };
  },
};
