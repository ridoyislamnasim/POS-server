import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { catalogProductsController } from "./catalog.products.controller.js";
import { catalogTaxonomyController as taxonomy } from "./catalog.taxonomy.controller.js";
import {
  attributeSchema,
  barcodeSchema,
  brandSchema,
  categorySchema,
  createProductSchema,
  generateVariantsSchema,
  optionSchema,
  subcategorySchema,
  unitSchema,
  updateProductSchema,
  uploadSchema,
  variantPatchSchema,
} from "./catalog.validation.js";

export const catalogRouter = Router();
catalogRouter.use(requireAuth, requireTenant);

const manage = requirePermission("catalog.manage");

catalogRouter.post("/uploads", manage, validateBody(uploadSchema), catalogProductsController.upload);

catalogRouter.get("/categories", taxonomy.listCategories);
catalogRouter.post("/categories", manage, validateBody(categorySchema), taxonomy.createCategory);
catalogRouter.patch("/categories/:id", manage, taxonomy.updateCategory);
catalogRouter.delete("/categories/:id", manage, taxonomy.deleteCategory);

catalogRouter.get("/subcategories", taxonomy.listSubcategories);
catalogRouter.post("/subcategories", manage, validateBody(subcategorySchema), taxonomy.createSubcategory);
catalogRouter.patch("/subcategories/:id", manage, taxonomy.updateSubcategory);
catalogRouter.delete("/subcategories/:id", manage, taxonomy.deleteSubcategory);

catalogRouter.get("/brands", taxonomy.listBrands);
catalogRouter.post("/brands", manage, validateBody(brandSchema), taxonomy.createBrand);
catalogRouter.patch("/brands/:id", manage, taxonomy.updateBrand);
catalogRouter.delete("/brands/:id", manage, taxonomy.deleteBrand);

catalogRouter.get("/units", taxonomy.listUnits);
catalogRouter.post("/units", manage, validateBody(unitSchema), taxonomy.createUnit);
catalogRouter.patch("/units/:id", manage, taxonomy.updateUnit);
catalogRouter.delete("/units/:id", manage, taxonomy.deleteUnit);

catalogRouter.get("/attributes", taxonomy.listAttributes);
catalogRouter.post("/attributes", manage, validateBody(attributeSchema), taxonomy.createAttribute);
catalogRouter.patch("/attributes/:id", manage, taxonomy.updateAttribute);
catalogRouter.delete("/attributes/:id", manage, taxonomy.deleteAttribute);
catalogRouter.post("/attributes/:id/options", manage, validateBody(optionSchema), taxonomy.createOption);
catalogRouter.patch("/attribute-options/:id", manage, taxonomy.updateOption);
catalogRouter.delete("/attribute-options/:id", manage, taxonomy.deleteOption);

catalogRouter.get("/tax-categories", taxonomy.listTaxCategories);

catalogRouter.get("/products", catalogProductsController.listProducts);
catalogRouter.get("/variants", catalogProductsController.listVariants);
catalogRouter.get("/barcode/:code", catalogProductsController.lookupBarcode);
catalogRouter.get("/products/:id/matrix", catalogProductsController.matrix);
catalogRouter.get("/products/:id", catalogProductsController.getProduct);
catalogRouter.post("/products", manage, validateBody(createProductSchema), catalogProductsController.createProduct);
catalogRouter.patch("/products/:id", manage, validateBody(updateProductSchema), catalogProductsController.updateProduct);
catalogRouter.post("/products/:id/archive", manage, catalogProductsController.archiveProduct);
catalogRouter.post(
  "/products/:id/generate-variants",
  manage,
  validateBody(generateVariantsSchema),
  catalogProductsController.generateVariants,
);
catalogRouter.patch("/variants/:id", manage, validateBody(variantPatchSchema), catalogProductsController.patchVariant);
catalogRouter.delete("/variants/:id", manage, catalogProductsController.deleteVariant);
catalogRouter.post("/variants/:id/barcodes", manage, validateBody(barcodeSchema), catalogProductsController.addBarcode);
