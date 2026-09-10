import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { dispositionFor, remainingReturnQty } from "../sales/returns.service.js";
import { mapStockTotals, readBuckets } from "./stock.engine.js";

describe("return disposition", () => {
  it("GOOD restocks available, damaged conditions quarantine sellable stock, RESTOCK_NOT_ALLOWED holds", () => {
    expect(dispositionFor("GOOD")).toBe("AVAILABLE");
    expect(dispositionFor("DAMAGED")).toBe("DAMAGED");
    expect(dispositionFor("DEFECTIVE")).toBe("DAMAGED");
    expect(dispositionFor("EXPIRED")).toBe("DAMAGED");
    expect(dispositionFor("MISSING_PARTS")).toBe("DAMAGED");
    expect(dispositionFor("RESTOCK_NOT_ALLOWED")).toBe("QUARANTINE");
  });

  it("never allows return qty above remaining sold qty", () => {
    expect(remainingReturnQty(5, 2).toString()).toBe("3");
    expect(remainingReturnQty(5, 5).toString()).toBe("0");
    expect(remainingReturnQty(5, 8).toString()).toBe("0");
  });
});

describe("stock buckets", () => {
  it("separates available, reserved, damaged, quarantine, and physical", () => {
    const b = readBuckets({
      quantity: new Prisma.Decimal(10),
      reservedQuantity: new Prisma.Decimal(3),
      damagedQuantity: new Prisma.Decimal(2),
      quarantineQuantity: new Prisma.Decimal(1),
    });
    expect(Number(b.available)).toBe(7);
    expect(Number(b.physical)).toBe(13);
    expect(Number(b.damaged)).toBe(2);
    expect(Number(b.quarantine)).toBe(1);
    const mapped = mapStockTotals({
      quantity: new Prisma.Decimal(10),
      reservedQuantity: new Prisma.Decimal(3),
      damagedQuantity: new Prisma.Decimal(2),
      quarantineQuantity: new Prisma.Decimal(1),
      unitCost: new Prisma.Decimal(4),
    });
    expect(mapped.availableValue).toBe(28);
    expect(mapped.damagedValue).toBe(8);
  });
});
