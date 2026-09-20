import { describe, expect, it } from "vitest";
import { createProductSchema } from "./catalog.validation.js";

const base = {
  name: "Test Product",
  code: "TST-001",
  categoryId: "test-cat-ethnic",
};

describe("createProductSchema pricing rules", () => {
  it("requires main prices for SIMPLE products", () => {
    const r = createProductSchema.safeParse({ ...base, type: "SIMPLE" });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => String(i.path[0]));
      expect(paths).toContain("purchasePrice");
      expect(paths).toContain("wholesalePrice");
      expect(paths).toContain("retailPrice");
    }
  });

  it("accepts SIMPLE products with all main prices", () => {
    const r = createProductSchema.safeParse({
      ...base,
      type: "SIMPLE",
      purchasePrice: "10",
      wholesalePrice: "12",
      retailPrice: "15",
    });
    expect(r.success).toBe(true);
  });

  it("allows empty main prices for VARIABLE products", () => {
    const r = createProductSchema.safeParse({ ...base, type: "VARIABLE" });
    expect(r.success).toBe(true);
  });

  it("still rejects negative main prices for VARIABLE products", () => {
    const r = createProductSchema.safeParse({
      ...base,
      type: "VARIABLE",
      purchasePrice: "-5",
    });
    expect(r.success).toBe(false);
  });
});