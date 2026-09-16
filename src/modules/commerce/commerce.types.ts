export type SalesOrderItemInput = {
  variantId: string;
  qty: number;
  unitPrice?: number | string;
};

export type CreateSalesOrderInput = {
  branchId: string;
  customerId?: string;
  notes?: string;
  items: SalesOrderItemInput[];
};

export type UpdateSalesOrderInput = {
  status?: string;
  notes?: string;
};

export type CreateEcommerceOrderInput = {
  channel: string;
  externalId: string | number;
  customerId?: string;
  total: string | number;
  payload?: unknown;
  status?: string;
};

export type CreateDeliveryInput = {
  branchId: string;
  salesOrderId?: string;
  saleId?: string;
  address: string;
  phone?: string;
  courier?: string;
  tracking?: string;
  scheduledAt?: string;
  notes?: string;
};

export type UpdateDeliveryInput = {
  status?: string;
  courier?: string;
  tracking?: string;
  address?: string;
  phone?: string;
  notes?: string;
};
