export type CreateAccessRequestInput = {
  type?: string;
  requestedPlanId?: string;
  reason?: string;
};

export type ListAccessRequestsQuery = {
  status?: string;
  type?: string;
  tenantId?: string;
  page?: string | number;
  pageSize?: string | number;
};
