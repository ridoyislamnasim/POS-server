export type CategoryInput = {
  name: string;
  slug?: string;
  status?: string;
  sortOrder?: number | string;
};

export type SubcategoryInput = {
  name: string;
  categoryId: string;
  slug?: string;
  status?: string;
  sortOrder?: number | string;
};

export type BrandInput = {
  name: string;
  status?: string;
};

export type UnitInput = {
  name: string;
  abbreviation?: string;
  code?: string;
  status?: string;
  sortOrder?: number | string;
};

export type AttributeInput = {
  name: string;
  key?: string;
  dataType?: string;
  variantDefining?: boolean;
  sortOrder?: number | string;
  options?: { value?: string; label: string }[];
};

export type OptionInput = {
  label?: string;
  name?: string;
  value?: string;
  sortOrder?: number | string;
};

export type ProductInput = Record<string, unknown>;

export type VariantPatchInput = Record<string, unknown>;

export type BarcodeInput = {
  code: string;
  kind?: string;
  primary?: boolean;
};
