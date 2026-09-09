export const FashionPackV1 = {
  key: "FASHION",
  version: "1.0.0",
  attributes: [
    { key: "colour", name: "Colour", variantDefining: true, sortOrder: 1 },
    { key: "size", name: "Size", variantDefining: true, sortOrder: 2 },
    { key: "fit", name: "Fit", variantDefining: false, sortOrder: 3 },
  ],
  matrix: { row: "colour", col: "size", widget: "matrix" },
  defaults: { currency: "BDT", country: "BD" },
} as const;
