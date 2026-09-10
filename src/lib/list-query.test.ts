import { describe, expect, it } from "vitest";
import { acceptEnum, acceptId, parseListQuery, paginationMeta } from "./list-query.js";

describe("parseListQuery", () => {
  it("clamps limit to 100 and defaults page/limit", () => {
    const q = parseListQuery({ limit: 9999, page: 0, sortBy: "createdAt;drop", sortOrder: "ASC" }, {
      sortable: ["createdAt", "name"],
    });
    expect(q.limit).toBe(100);
    expect(q.page).toBe(1);
    expect(q.sortBy).toBe("createdAt");
    expect(q.sortOrder).toBe("asc");
  });

  it("reads search from q or search and rejects unknown sort", () => {
    const q = parseListQuery({ q: "  shirt  ", sortBy: "passwordHash" }, { sortable: ["name"], defaultSort: "name" });
    expect(q.search).toBe("shirt");
    expect(q.sortBy).toBe("name");
    expect(q.skip).toBe(0);
  });

  it("builds pagination meta", () => {
    expect(paginationMeta(0, 1, 25)).toEqual({ page: 1, limit: 25, total: 0, totalPages: 1 });
    expect(paginationMeta(101, 2, 25).totalPages).toBe(5);
  });

  it("accepts ids and enums safely", () => {
    expect(acceptId("clxyz1234567890abcd")).toBe("clxyz1234567890abcd");
    expect(acceptId("1 OR 1=1")).toBeUndefined();
    expect(acceptEnum("ACTIVE", ["ACTIVE", "ARCHIVED"] as const)).toBe("ACTIVE");
    expect(acceptEnum("nope", ["ACTIVE"] as const)).toBeUndefined();
  });
});
