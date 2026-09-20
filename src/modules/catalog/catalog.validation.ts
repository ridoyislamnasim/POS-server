import { z } from "zod";

export const categorySchema = z.object({
  name: z.string().min(1, "name required"),
  slug: z.string().optional(),
  status: z.string().optional().default("ACTIVE"),
  sortOrder: z.union([z.string(), z.number()]).optional(),
});

export const subcategorySchema = z.object({
  name: z.string().min(1, "name and categoryId required"),
  categoryId: z.string().min(1, "name and categoryId required"),
  slug: z.string().optional(),
  status: z.string().optional().default("ACTIVE"),
  sortOrder: z.union([z.string(), z.number()]).optional(),
});

export const brandSchema = z.object({
  name: z.string().min(1, "name required"),
  status: z.string().optional().default("ACTIVE"),
});

export const unitSchema = z.object({
  name: z.string().min(1, "name and abbreviation required"),
  abbreviation: z.string().optional(),
  code: z.string().optional(),
  status: z.string().optional().default("ACTIVE"),
  sortOrder: z.union([z.string(), z.number()]).optional(),
});

export const attributeSchema = z.object({
  name: z.string().min(1, "name required"),
  key: z.string().optional(),
  dataType: z.string().optional(),
  variantDefining: z.boolean().optional(),
  sortOrder: z.union([z.string(), z.number()]).optional(),
  options: z.array(z.object({ value: z.string().optional(), label: z.string() })).optional(),
});

export const optionSchema = z.object({
  label: z.string().optional(),
  name: z.string().optional(),
  value: z.string().optional(),
  sortOrder: z.union([z.string(), z.number()]).optional(),
});

export const createProductSchema = z.object({
  name: z.string().min(1, "name and code required"),
  code: z.string().min(1, "name and code required"),
  categoryId: z.string().min(1, "category is required"),
}).passthrough();

export const updateProductSchema = z.object({}).passthrough();

export const variantPatchSchema = z.object({}).passthrough();

export const barcodeSchema = z.object({
  code: z.string().min(1, "code required"),
  kind: z.string().optional(),
  primary: z.boolean().optional(),
});

export const uploadSchema = z.object({
  dataUrl: z.string().min(1, "dataUrl required"),
});

export const generateVariantsSchema = z.object({
  axes: z.array(z.object({ definitionId: z.string(), optionIds: z.array(z.string()) })).optional(),
  colourOptionIds: z.array(z.string()).optional(),
  sizeOptionIds: z.array(z.string()).optional(),
  price: z.union([z.string(), z.number()]).optional(),
  cost: z.union([z.string(), z.number()]).optional(),
  discount: z.union([z.string(), z.number()]).optional(),
  openingStock: z.unknown().optional(),
  variants: z.array(z.unknown()).optional(),
}).passthrough();

export type CategoryBody = z.infer<typeof categorySchema>;
export type SubcategoryBody = z.infer<typeof subcategorySchema>;
export type BrandBody = z.infer<typeof brandSchema>;
export type UnitBody = z.infer<typeof unitSchema>;
export type AttributeBody = z.infer<typeof attributeSchema>;
export type OptionBody = z.infer<typeof optionSchema>;
