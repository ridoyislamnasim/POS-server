import { Router } from "express";
import { requireAuth, requirePermission, requireTenant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { inventoryController } from "./inventory.controller.js";
import {
  adjustStockSchema,
  createDamageSchema,
  createReceiptSchema,
  reserveStockSchema,
  stockTakeSchema,
  transferStockSchema,
} from "./inventory.validation.js";

export const inventoryRouter = Router();
inventoryRouter.use(requireAuth, requireTenant, requirePermission("inventory.view"));

inventoryRouter.get("/", inventoryController.list);
inventoryRouter.get("/locations", inventoryController.listLocations);
inventoryRouter.get("/stock", inventoryController.listByLocation);
inventoryRouter.get("/movements", requirePermission("inventory.ledger.view"), inventoryController.listMovements);
inventoryRouter.post("/adjust", requirePermission("inventory.adjust"), validateBody(adjustStockSchema), inventoryController.adjust);
inventoryRouter.post("/transfer", requirePermission("inventory.transfer"), validateBody(transferStockSchema), inventoryController.transfer);
inventoryRouter.post("/stock-takes", requirePermission("inventory.adjust"), validateBody(stockTakeSchema), inventoryController.postStockTake);
inventoryRouter.get("/stock-takes", inventoryController.listStockTakes);
inventoryRouter.post("/reserve", requirePermission("inventory.reserve"), validateBody(reserveStockSchema), inventoryController.reserve);
inventoryRouter.get("/receipts", requirePermission("inventory.receive.view"), inventoryController.listReceipts);
inventoryRouter.get("/receipts/summary", requirePermission("inventory.receive.view"), inventoryController.receiptsSummary);
inventoryRouter.get("/receipts/:id", requirePermission("inventory.receive.view"), inventoryController.getReceipt);
inventoryRouter.post("/receipts", requirePermission("inventory.receive.create"), validateBody(createReceiptSchema), inventoryController.createReceipt);
inventoryRouter.post("/receipts/:id/receive", requirePermission("inventory.receive.approve"), inventoryController.receiveReceipt);
inventoryRouter.post("/receipts/:id/cancel", requirePermission("inventory.receive.approve"), inventoryController.cancelReceipt);
inventoryRouter.get("/damages", requirePermission("inventory.damage.view"), inventoryController.listDamages);
inventoryRouter.get("/damages/summary", requirePermission("inventory.damage.view"), inventoryController.damagesSummary);
inventoryRouter.get("/damages/:id", requirePermission("inventory.damage.view"), inventoryController.getDamage);
inventoryRouter.post("/damages", requirePermission("inventory.damage.create"), validateBody(createDamageSchema), inventoryController.createDamage);
inventoryRouter.post("/damages/:id/submit", requirePermission("inventory.damage.create"), inventoryController.submitDamage);
inventoryRouter.post("/damages/:id/approve", requirePermission("inventory.damage.approve"), inventoryController.approveDamage);
inventoryRouter.post("/damages/:id/reject", requirePermission("inventory.damage.approve"), inventoryController.rejectDamage);
inventoryRouter.get("/summary", inventoryController.summary);
inventoryRouter.get("/:variantId", inventoryController.getVariant);
