export type ReportRange = {
  from: string;
  to: string;
  gte: Date;
  lte: Date;
};

export type ReportQuery = Record<string, unknown>;
