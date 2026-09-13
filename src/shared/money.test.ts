import { describe, expect, it } from "vitest";
import {
  invoiceTotals,
  itemDiscountAmount,
  lineTotals,
  percentAmount,
  roundMoney,
  transactionDiscountAmount,
} from "./money";

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

  it("percentAmount rounds half up", () => {
    expect(percentAmount("100", "10").toFixed(2)).toBe("10.00");
    expect(percentAmount("300", "20").toFixed(2)).toBe("60.00");
  });

  it("percentAmount is zero when percent <= 0", () => {
    expect(percentAmount("100", "0").toFixed(2)).toBe("0.00");
    expect(percentAmount("100", "-5").toFixed(2)).toBe("0.00");
  });

  it("itemDiscountAmount applies percent to price × qty", () => {
    const d = itemDiscountAmount({ unitPrice: "100", qty: 3, percent: "20" });
    expect(d.toFixed(2)).toBe("60.00");
  });

  it("itemDiscountAmount applies flat", () => {
    const d = itemDiscountAmount({ unitPrice: "100", qty: 1, flat: "10" });
    expect(d.toFixed(2)).toBe("10.00");
  });

  it("itemDiscountAmount sums flat + percent", () => {
    const d = itemDiscountAmount({ unitPrice: "100", qty: 2, flat: "15", percent: "10" });
    expect(d.toFixed(2)).toBe("35.00");
  });

  it("itemDiscountAmount never exceeds extended", () => {
    const d = itemDiscountAmount({ unitPrice: "100", qty: 1, percent: "200" });
    expect(d.toFixed(2)).toBe("100.00");
  });

  it("itemDiscountAmount is zero when no discount given", () => {
    const d = itemDiscountAmount({ unitPrice: "100", qty: 1 });
    expect(d.toFixed(2)).toBe("0.00");
  });

  it("itemDiscountAmount is zero for negative inputs", () => {
    const d = itemDiscountAmount({ unitPrice: "100", qty: 1, flat: "-25", percent: "-10" });
    expect(d.toFixed(2)).toBe("0.00");
  });

  it("transactionDiscountAmount applies percent to subtotal", () => {
    const d = transactionDiscountAmount({ subtotal: "1000", percent: "5" });
    expect(d.toFixed(2)).toBe("50.00");
  });

  it("transactionDiscountAmount never exceeds subtotal", () => {
    const d = transactionDiscountAmount({ subtotal: "100", flat: "200" });
    expect(d.toFixed(2)).toBe("100.00");
  });

  it("transactionDiscountAmount is zero when no discount given", () => {
    const d = transactionDiscountAmount({ subtotal: "500" });
    expect(d.toFixed(2)).toBe("0.00");
  });
});
