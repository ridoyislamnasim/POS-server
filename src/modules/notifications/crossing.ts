import type { StockAlertLevel } from "@prisma/client";

export function nextStockLevel(available: number, threshold: number): StockAlertLevel {
  if (available <= 0) return "OUT";
  if (available <= threshold) return "LOW";
  return "OK";
}

export function shouldNotifyStockCrossing(prev: StockAlertLevel | null | undefined, next: StockAlertLevel) {
  const before = prev ?? "OK";
  if (before === "OK" && (next === "LOW" || next === "OUT")) return true;
  if (before === "LOW" && next === "OUT") return true;
  return false;
}

export function stockAlertPriority(level: StockAlertLevel, available: number, threshold: number) {
  if (level === "OUT") return "CRITICAL" as const;
  if (level === "LOW" && available <= Math.max(1, Math.floor(threshold / 2))) return "HIGH" as const;
  return "NORMAL" as const;
}
