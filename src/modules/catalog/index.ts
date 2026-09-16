export { catalogRouter } from "./catalog.routes.js";
export { catalogProductsController } from "./catalog.products.controller.js";
export { catalogTaxonomyController } from "./catalog.taxonomy.controller.js";
export { catalogProductsService } from "./catalog.products.service.js";
export { catalogTaxonomyService } from "./catalog.taxonomy.service.js";
export { catalogRepository } from "./catalog.repository.js";
// Variant-engine helpers (SKU/barcode guards, variant generation, opening stock).
export {
  assertUniqueBarcode,
  assertUniqueProductCode,
  assertUniqueSku,
  applyOpeningStock,
  createVariantRecord,
  generateFromAxes,
  productInclude,
  productListInclude,
} from "./catalog.service.js";
