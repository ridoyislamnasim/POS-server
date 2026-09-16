export type CreateCustomerInput = {
  name?: string;
  phone: string;
  email?: string;
  address?: string;
  notes?: string;
  taxId?: string;
  creditLimit?: string | number;
  type?: string;
  createOnly?: boolean;
};

export type UpdateCustomerInput = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
  taxId?: string;
  type?: string;
  status?: string;
  creditLimit?: string | number;
  birthday?: string;
};

export type AdjustLoyaltyInput = {
  type: string;
  points: string | number;
  notes?: string;
};
