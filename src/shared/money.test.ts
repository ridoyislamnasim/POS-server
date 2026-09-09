import { describe, expect, it } from "vitest";
import { invoiceTotals, lineTotals, roundMoney } from "./money";

describe("money", () => {
  it("rounds half up", () => {
    expect(roundMoney("10.125").toFixed(2)).toBe("10.13");
  });

  it("exclusive tax line then invoice", () => {
    const line = lineTotals({
      unitPrice: "100",
      qty: 2,
      lineDiscount: "20",
      taxRatePercent: "5",
    });
    expect(line.taxable.toFixed(2)).toBe("180.00");
    expect(line.tax.toFixed(2)).toBe("9.00");
    expect(line.lineTotal.toFixed(2)).toBe("189.00");
    const inv = invoiceTotals([line]);
    expect(inv.total.toFixed(2)).toBe("189.00");
  });
});
