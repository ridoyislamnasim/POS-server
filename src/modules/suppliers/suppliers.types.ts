export type CreateSupplierInput = {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  taxId?: string;
  notes?: string;
};

export type UpdateSupplierInput = Partial<CreateSupplierInput> & {
  status?: string;
};
