export type UpdateSettingsInput = Record<string, unknown>;

export type CreateTaxInput = {
  name: string;
  rate: string | number;
};

export type CreateTemplateInput = {
  name: string;
  kind: string;
  body: string;
  isDefault?: boolean;
};

export type CreateCurrencyInput = {
  code: string;
  name: string;
  minorUnits?: number;
};
