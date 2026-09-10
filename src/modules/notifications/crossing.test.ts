import { describe, expect, it } from "vitest";
import { nextStockLevel, shouldNotifyStockCrossing, stockAlertPriority } from "./crossing.js";
import { safeActionUrl } from "./settings.js";

describe("stock alert crossing", () => {
  it("maps available qty to OK / LOW / OUT", () => {
    expect(nextStockLevel(100, 5)).toBe("OK");
    expect(nextStockLevel(5, 5)).toBe("LOW");
    expect(nextStockLevel(4, 5)).toBe("LOW");
    expect(nextStockLevel(0, 5)).toBe("OUT");
    expect(nextStockLevel(-1, 5)).toBe("OUT");
  });

  it("notifies only on OK→LOW, OK→OUT, and LOW→OUT", () => {
    expect(shouldNotifyStockCrossing("OK", "LOW")).toBe(true);
    expect(shouldNotifyStockCrossing(undefined, "LOW")).toBe(true);
    expect(shouldNotifyStockCrossing("OK", "OUT")).toBe(true);
    expect(shouldNotifyStockCrossing("LOW", "OUT")).toBe(true);
    expect(shouldNotifyStockCrossing("LOW", "LOW")).toBe(false);
    expect(shouldNotifyStockCrossing("OUT", "OUT")).toBe(false);
    expect(shouldNotifyStockCrossing("LOW", "OK")).toBe(false);
    expect(shouldNotifyStockCrossing("OUT", "LOW")).toBe(false);
    expect(shouldNotifyStockCrossing("OUT", "OK")).toBe(false);
    expect(shouldNotifyStockCrossing("OK", "OK")).toBe(false);
  });

  it("uses CRITICAL for out of stock and HIGH near half-threshold", () => {
    expect(stockAlertPriority("OUT", 0, 5)).toBe("CRITICAL");
    expect(stockAlertPriority("LOW", 1, 5)).toBe("HIGH");
    expect(stockAlertPriority("LOW", 4, 5)).toBe("NORMAL");
  });
});

describe("safeActionUrl", () => {
  it("allows relative app paths only", () => {
    expect(safeActionUrl("/inventory?q=SKU")).toBe("/inventory?q=SKU");
    expect(safeActionUrl("https://evil.test")).toBe(null);
    expect(safeActionUrl("//evil.test")).toBe(null);
    expect(safeActionUrl("javascript:alert(1)")).toBe(null);
    expect(safeActionUrl("/sales")).toBe("/sales");
  });
});
