import type { Request } from "express";
import type { RequestContext } from "../types.js";
import { ForbiddenError } from "./scope.js";

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

const ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T\s].*)?$/;

export type SortOrder = "asc" | "desc";

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type ListQuery = {
  page: number;
  limit: number;
  skip: number;
  take: number;
  search: string;
  sortBy: string;
  sortOrder: SortOrder;
  dateFrom?: Date;
  dateTo?: Date;
};

export function parseIntParam(raw: unknown, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function parseListQuery(
  query: Record<string, unknown> | Request["query"],
  opts: {
    sortable?: readonly string[];
    defaultSort?: string;
    defaultOrder?: SortOrder;
    defaultLimit?: number;
  } = {},
): ListQuery {
  const sortable = opts.sortable ?? ["createdAt"];
  const defaultSort = opts.defaultSort ?? sortable[0] ?? "createdAt";
  const defaultLimit = opts.defaultLimit ?? DEFAULT_LIMIT;
  const page = parseIntParam(query.page, DEFAULT_PAGE, 1, 1_000_000);
  const limit = parseIntParam(query.limit ?? query.pageSize, defaultLimit, 1, MAX_LIMIT);
  const searchRaw = query.search ?? query.q;
  const search = typeof searchRaw === "string" ? searchRaw.trim().slice(0, 200) : "";
  const sortRaw = typeof query.sortBy === "string" ? query.sortBy : defaultSort;
  const sortBy = sortable.includes(sortRaw) ? sortRaw : defaultSort;
  const orderRaw = String(query.sortOrder ?? query.order ?? opts.defaultOrder ?? "desc").toLowerCase();
  const sortOrder: SortOrder = orderRaw === "asc" ? "asc" : "desc";
  const dateFrom = acceptDate(query.from ?? query.dateFrom);
  const dateTo = acceptDate(query.to ?? query.dateTo);
  return {
    page,
    limit,
    skip: (page - 1) * limit,
    take: limit,
    search,
    sortBy,
    sortOrder,
    dateFrom,
    dateTo,
  };
}

export function paginationMeta(total: number, page: number, limit: number): Pagination {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const totalPages = Math.max(1, Math.ceil(safeTotal / limit) || 1);
  return { page, limit, total: safeTotal, totalPages };
}

export async function withPagination<T>(
  list: ListQuery,
  fns: {
    find: (skip: number, take: number) => Promise<T[]>;
    count: () => Promise<number>;
  },
): Promise<{ rows: T[]; pagination: Pagination }> {
  const [rows, total] = await Promise.all([fns.find(list.skip, list.take), fns.count()]);
  return { rows, pagination: paginationMeta(total, list.page, list.limit) };
}

export function ilike(q: string) {
  return { contains: q, mode: "insensitive" as const };
}

export function acceptId(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s || s === "ALL" || s === "undefined" || s === "null") return undefined;
  if (!ID_RE.test(s)) return undefined;
  return s;
}

export function acceptEnum<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s || s === "ALL") return undefined;
  return (allowed as readonly string[]).includes(s) ? (s as T) : undefined;
}

export function acceptDate(raw: unknown): Date | undefined {
  if (raw == null || raw === "") return undefined;
  const s = String(raw).trim();
  if (!DATE_RE.test(s)) return undefined;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

export function dateRange(from?: Date, to?: Date): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  const range: { gte?: Date; lte?: Date } = {};
  if (from) range.gte = from;
  if (to) {
    const end = new Date(to);
    if (end.getHours() === 0 && end.getMinutes() === 0 && end.getSeconds() === 0) {
      end.setHours(23, 59, 59, 999);
    }
    range.lte = end;
  }
  return range;
}

export function createdAtRange(list: ListQuery) {
  return dateRange(list.dateFrom, list.dateTo);
}

/** Intersect an optional branch filter with the authenticated branch scope. */
export function scopedBranchId(ctx: RequestContext, raw?: unknown): string | undefined {
  const id = acceptId(raw);
  if (!id) return undefined;
  if (ctx.allBranches || ctx.isPlatform) return id;
  if (!ctx.branchIds.includes(id)) throw new ForbiddenError("Branch not allowed");
  return id;
}

export function orderByField(sortBy: string, sortOrder: SortOrder): Record<string, SortOrder> {
  return { [sortBy]: sortOrder };
}
