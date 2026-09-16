export type UpdateRoleInput = {
  permissions: string[];
};

export type CreateAttendanceInput = {
  userId: string;
  branchId: string;
  status?: string;
  checkIn?: string;
  checkOut?: string;
  notes?: string;
  workDate?: string;
};

export type CreateShiftTemplateInput = {
  name: string;
  startTime: string;
  endTime: string;
  days?: string[];
};
