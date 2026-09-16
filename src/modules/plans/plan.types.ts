export type CreatePlanInput = {
  code: string;
  name: string;
  description?: string;
  interval?: "MONTHLY" | "YEARLY";
  price?: number;
  yearlyPrice?: number;
  currency?: string;
  displayOrder?: number;
};

export type UpdatePlanInput = Partial<CreatePlanInput> & {
  active?: boolean;
};
