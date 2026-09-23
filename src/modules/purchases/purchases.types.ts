export type OrderItemInput = {
  variantId: string;
  qty: number;
  unitCost: number;
  taxRate?: number;
  retailPrice?: number;
  wholesalePrice?: number;
};

export type CreateOrderInput = {
  branchId: string;
  supplierId: string;
  notes?: string;
  expectedAt?: string;
  items: OrderItemInput[];
};

export type ReceiveItemInput = {
  variantId: string;
  qty: number;
  unitCost: number;
  taxRate?: number;
  retailPrice?: number;
  wholesalePrice?: number;
  discount?: number;
};

export type ReceivePurchaseInput = {
  branchId: string;
  locationId?: string;
  supplierId: string;
  purchaseOrderId?: string;
  paid?: string | number;
  notes?: string;
  items: ReceiveItemInput[];
};

export type ReturnItemInput = {
  purchaseItemId: string;
  qty: number;
};

export type CreatePurchaseReturnInput = {
  reason: string;
  notes?: string;
  items: ReturnItemInput[];
};
