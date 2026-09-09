import { describe, expect, it } from "vitest";
import { lineTotals } from "./shared/money";

describe("tax rounding order", () => {
  it("does not use IEEE float", () => {
    const line = lineTotals({ unitPrice: "99.99", qty: 3, taxRatePercent: "5" });
    expect(line.lineTotal.toFixed(2)).toBe("314.97");
  });
});
