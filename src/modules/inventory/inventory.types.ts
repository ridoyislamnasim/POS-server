export type AdjustStockInput = {
  variantId: string;
  locationId: string;
  direction: string;
  quantity: number;
  reason: string;
  notes?: string;
};

export type TransferStockInput = {
  variantId: string;
  fromLocationId: string;
  toLocationId: string;
  quantity: number;
  notes?: string;
};

export type StockTakeLineInput = {
  variantId: string;
  countedQty: number;
};

export type StockTakeInput = {
  branchId: string;
  locationId: string;
  notes?: string;
  lines: StockTakeLineInput[];
};

export type ReserveStockInput = {
  variantId: string;
  locationId: string;
  quantity: number;
  release?: boolean;
};
