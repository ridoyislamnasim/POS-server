export type SalesOrderItemInput = {
  variantId: string;
  qty: number;
  unitPrice?: number | string;
  originalPrice?: number | string;
  discountAmount?: number | string;
  discountPercent?: number | string;
  discountReason?: string;
  taxRate?: number | string;
};

export type CreateSalesOrderInput = {
  branchId: string;
  locationId?: string;
  customerId?: string;
  notes?: string;
  customerNotes?: string;
  internalNotes?: string;
  deliveryNotes?: string;
  expectedDeliveryAt?: string;
  reference?: string;
  discount?: number | string;
  tax?: number | string;
  status?: string;
  items: SalesOrderItemInput[];
};

export type UpdateSalesOrderInput = {
  status?: string;
  notes?: string;
  customerNotes?: string;
  internalNotes?: string;
  deliveryNotes?: string;
  expectedDeliveryAt?: string | null;
  reference?: string | null;
  locationId?: string;
  branchId?: string;
  customerId?: string | null;
  items?: SalesOrderItemInput[];
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
