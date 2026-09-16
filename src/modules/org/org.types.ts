export type UpdateBusinessInput = {
  name?: string;
  legalName?: string;
  vatId?: string;
  address?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  currency?: string;
  tenantName?: string;
};

export type CreateBranchInput = {
  name: string;
  code: string;
  type?: string;
  timezone?: string;
  negativeStockPolicy?: string;
};

export type UpdateBranchInput = {
  name?: string;
  operationalStatus?: string;
  timezone?: string;
  negativeStockPolicy?: string;
};

export type CreateWarehouseInput = {
  name: string;
};

export type UpdateWarehouseInput = {
  name?: string;
};
