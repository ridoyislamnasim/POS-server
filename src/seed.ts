import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_VARIANT_KEY } from "./shared/cartesian";
import { invoiceTotals, lineTotals, toMoneyString } from "./shared/money";
import { buildVariantKey } from "./shared/variant-key";
import { CASHIER_KEYS, MANAGER_KEYS, Permissions } from "./shared/permissions";

const prisma = new PrismaClient();

const TAX_RATE = 5;
const YEAR = new Date().getFullYear();

function bizDate(daysAgo: number) {
  const now = new Date();
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  utc.setUTCDate(utc.getUTCDate() - daysAgo);
  return utc;
}

function atHour(day: Date, hour: number, minute = 10) {
  const d = new Date(day);
  d.setUTCHours(hour, minute, 0, 0);
  return d;
}

function pad(n: number, width = 6) {
  return String(n).padStart(width, "0");
}

function money(n: number) {
  return toMoneyString(n);
}

type VariantPick = {
  id: string;
  sku: string;
  price: string;
  cost: string;
  productId: string;
  productName: string;
  snap: string;
};

async function wipe() {
  await prisma.saleReturnExchange.deleteMany();
  await prisma.saleReturnItem.deleteMany();
  await prisma.loginAttempt.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.accountingEvent.deleteMany();
  await prisma.fiscalDocument.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.saleDocument.deleteMany();
  await prisma.paymentTransaction.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.saleReturn.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.heldSale.deleteMany();
  await prisma.loyaltyTransaction.deleteMany();
  await prisma.ledgerPayment.deleteMany();
  await prisma.purchaseReturnItem.deleteMany();
  await prisma.purchaseReturn.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.salesOrderItem.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.ecommerceOrder.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.stockAlertState.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.expenseCategory.deleteMany();
  await prisma.income.deleteMany();
  await prisma.dailyClosing.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.shiftTemplate.deleteMany();
  await prisma.invoiceTemplate.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.backupRecord.deleteMany();
  await prisma.packMigration.deleteMany();
  await prisma.stockTakeLine.deleteMany();
  await prisma.stockTake.deleteMany();
  await prisma.tenantSettings.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.barcode.deleteMany();
  await prisma.variantAttributeValue.deleteMany();
  await prisma.productBundleItem.deleteMany();
  await prisma.productImage.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.subcategory.deleteMany();
  await prisma.category.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.unit.deleteMany();
  await prisma.attributeOption.deleteMany();
  await prisma.attributeDefinition.deleteMany();
  await prisma.taxCategory.deleteMany();
  await prisma.tillDevice.deleteMany();
  await prisma.register.deleteMany();
  await prisma.documentNumberSequence.deleteMany();
  await prisma.userBranch.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.rolePermission.deleteMany();
  await prisma.permission.deleteMany();
  await prisma.role.deleteMany();
  await prisma.session.deleteMany();
  await prisma.userTenant.deleteMany();
  await prisma.user.deleteMany();
  await prisma.stockLocationChannel.deleteMany();
  await prisma.branch.deleteMany();
  await prisma.location.deleteMany();
  await prisma.business.deleteMany();
  await prisma.tenant.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.currency.deleteMany();
}

async function main() {
  await wipe();

  await prisma.currency.createMany({
    data: [
      { code: "BDT", name: "Bangladeshi Taka", minorUnits: 2 },
      { code: "USD", name: "US Dollar", minorUnits: 2 },
      { code: "EUR", name: "Euro", minorUnits: 2 },
      { code: "INR", name: "Indian Rupee", minorUnits: 2 },
      { code: "AED", name: "UAE Dirham", minorUnits: 2 },
      { code: "GBP", name: "Pound Sterling", minorUnits: 2 },
    ],
  });

  const growth = await prisma.plan.create({
    data: {
      code: "GROWTH",
      name: "Growth",
      interval: "MONTHLY",
      price: "4999",
      features: ["MULTI_BRANCH", "LOYALTY", "ECOMMERCE", "REPORTS", "WHATSAPP"],
      limits: { maxBranches: 5, maxUsers: 20, maxProducts: 5000, maxWarehouses: 5 },
    },
  });
  await prisma.plan.createMany({
    data: [
      {
        code: "STARTER",
        name: "Starter",
        interval: "MONTHLY",
        price: "1499",
        features: ["POS", "INVENTORY"],
        limits: { maxBranches: 1, maxUsers: 3, maxProducts: 500, maxWarehouses: 1 },
      },
      {
        code: "GROWTH_YEARLY",
        name: "Growth (Yearly)",
        interval: "YEARLY",
        price: "49990",
        features: ["MULTI_BRANCH", "LOYALTY", "ECOMMERCE", "REPORTS", "WHATSAPP"],
        limits: { maxBranches: 5, maxUsers: 20, maxProducts: 5000, maxWarehouses: 5 },
      },
      {
        code: "UNIVERSAL",
        name: "Universal",
        interval: "MONTHLY",
        price: "12999",
        features: ["ALL"],
        limits: { maxBranches: 99, maxUsers: 500, maxProducts: 100000, maxWarehouses: 50 },
      },
    ],
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: "Nokshi Lifestyle",
      industryPack: "FASHION",
      industryPackVersion: "1.0.0",
      country: "BD",
      timezone: "Asia/Dhaka",
      locale: "en",
      subscriptionStatus: "TRIAL",
      trialStart: bizDate(4),
      trialEnd: bizDate(-26),
      planId: growth.id,
    },
  });

  await prisma.tenantSettings.create({
    data: {
      tenantId: tenant.id,
      currency: "BDT",
      taxEnabled: true,
      defaultTaxRate: String(TAX_RATE),
      invoiceFooter: "Thank you for shopping at Nokshi Lifestyle",
      whatsappEnabled: true,
      emailEnabled: true,
      smsEnabled: false,
      language: "en",
      theme: "system",
      lowStockThreshold: 5,
      receiptPrinter: "EPSON-TM-T88",
      barcodePrinter: "TSC-TE244",
      paymentMethods: ["CASH", "CARD", "MFS", "BANK"],
      notifications: { lowStock: true, dailyClose: true, invoiceWhatsapp: true, receiptWidthMm: 80 },
    },
  });
  await prisma.invoiceTemplate.createMany({
    data: [
      {
        tenantId: tenant.id,
        name: "Standard",
        kind: "INVOICE",
        body: "{{business}} {{invoiceNumber}} {{total}}",
        isDefault: true,
      },
      {
        tenantId: tenant.id,
        name: "Thermal",
        kind: "BILL",
        body: "{{business}}\n{{invoiceNumber}}\n{{total}}\n{{footer}}",
        isDefault: true,
      },
      {
        tenantId: tenant.id,
        name: "Gift receipt",
        kind: "RECEIPT",
        body: "Gift receipt {{invoiceNumber}} — no prices",
        isDefault: false,
      },
    ],
  });

  await prisma.business.create({
    data: {
      tenantId: tenant.id,
      name: "Nokshi Lifestyle",
      legalName: "Nokshi Lifestyle Ltd.",
      vatId: "BIN-000123456",
      address: "House 12, Road 7, Dhanmondi, Dhaka 1209",
      phone: "+8801700000000",
      email: "hello@nokshi.example",
      currency: "BDT",
    },
  });

  const locDhk = await prisma.location.create({
    data: { tenantId: tenant.id, type: "STORE", name: "Dhanmondi Flagship Floor" },
  });
  const locUtt = await prisma.location.create({
    data: { tenantId: tenant.id, type: "STORE", name: "Uttara Store Floor" },
  });
  const locWh = await prisma.location.create({
    data: { tenantId: tenant.id, type: "WAREHOUSE", name: "Central Warehouse" },
  });
  const locKiosk = await prisma.location.create({
    data: { tenantId: tenant.id, type: "KIOSK", name: "Bashundhara City Kiosk" },
  });
  await prisma.stockLocationChannel.createMany({
    data: [
      { tenantId: tenant.id, locationId: locDhk.id, channel: "STORE" },
      { tenantId: tenant.id, locationId: locUtt.id, channel: "STORE" },
      { tenantId: tenant.id, locationId: locWh.id, channel: "WAREHOUSE" },
      { tenantId: tenant.id, locationId: locKiosk.id, channel: "STORE" },
    ],
  });

  const dhk = await prisma.branch.create({
    data: {
      tenantId: tenant.id,
      locationId: locDhk.id,
      name: "Dhanmondi Flagship",
      code: "DHK",
      negativeStockPolicy: "BLOCK",
    },
  });
  const utt = await prisma.branch.create({
    data: {
      tenantId: tenant.id,
      locationId: locUtt.id,
      name: "Uttara",
      code: "UTT",
      negativeStockPolicy: "BLOCK",
    },
  });

  const docTypes = [
    ["INVOICE", "INV"],
    ["BILL", "BILL"],
    ["RETURN", "RET"],
    ["PO", "PO"],
    ["PURCHASE", "GRN"],
    ["PURCHASE_RETURN", "PRT"],
    ["SALES_ORDER", "SO"],
    ["DELIVERY", "DLV"],
  ] as const;
  for (const b of [dhk, utt]) {
    await prisma.documentNumberSequence.createMany({
      data: docTypes.map(([documentType, tag]) => ({
        tenantId: tenant.id,
        branchId: b.id,
        documentType,
        fiscalYear: YEAR,
        prefix: `${b.code}-${tag}-${YEAR}-`,
        padding: 6,
        nextNumber: 1,
      })),
    });
  }

  const keys = [...Permissions];
  const perms = await Promise.all(keys.map((key) => prisma.permission.create({ data: { key } })));
  const perm = (k: string) => perms.find((p) => p.key === k)!.id;

  const ownerRole = await prisma.role.create({
    data: { tenantId: tenant.id, key: "TENANT_OWNER", name: "Tenant owner" },
  });
  const mgrRole = await prisma.role.create({
    data: { tenantId: tenant.id, key: "OUTLET_MANAGER", name: "Outlet manager" },
  });
  const cashRole = await prisma.role.create({
    data: { tenantId: tenant.id, key: "CASHIER", name: "Cashier" },
  });
  const platRole = await prisma.role.create({
    data: { tenantId: null, key: "PLATFORM_SUPER_ADMIN", name: "Platform super admin" },
  });

  await prisma.rolePermission.createMany({
    data: [
      ...keys.map((k) => ({ roleId: ownerRole.id, permissionId: perm(k) })),
      ...MANAGER_KEYS.map((k) => ({ roleId: mgrRole.id, permissionId: perm(k) })),
      ...CASHIER_KEYS.map((k) => ({ roleId: cashRole.id, permissionId: perm(k) })),
      ...keys.map((k) => ({ roleId: platRole.id, permissionId: perm(k) })),
    ],
  });

  const hash = (p: string) => bcrypt.hash(p, 10);
  const platform = await prisma.user.create({
    data: { email: "platform@pos.local", name: "Platform Admin", passwordHash: await hash("Admin123!") },
  });
  const owner = await prisma.user.create({
    data: {
      email: "owner@nokshi.local",
      name: "Nokshi Owner",
      phone: "+8801700000001",
      passwordHash: await hash("Owner123!"),
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: "manager@nokshi.local",
      name: "Outlet Manager",
      phone: "+8801700000002",
      passwordHash: await hash("Manager123!"),
    },
  });
  const c1 = await prisma.user.create({
    data: {
      email: "cashier.dhk@nokshi.local",
      name: "Dhanmondi Cashier",
      phone: "+8801700000011",
      passwordHash: await hash("Cashier123!"),
    },
  });
  const c2 = await prisma.user.create({
    data: {
      email: "cashier.utt@nokshi.local",
      name: "Uttara Cashier",
      phone: "+8801700000012",
      passwordHash: await hash("Cashier123!"),
    },
  });
  const c3 = await prisma.user.create({
    data: {
      email: "cashier.dhk2@nokshi.local",
      name: "Dhanmondi Cashier 2",
      phone: "+8801700000013",
      passwordHash: await hash("Cashier123!"),
    },
  });
  const inactiveUser = await prisma.user.create({
    data: {
      email: "inactive@nokshi.local",
      name: "Former Cashier",
      passwordHash: await hash("Cashier123!"),
      status: "DEACTIVATED",
    },
  });

  await prisma.userTenant.createMany({
    data: [
      { userId: platform.id, tenantId: tenant.id, isPlatform: true, allBranches: true },
      { userId: owner.id, tenantId: tenant.id, allBranches: true },
      { userId: manager.id, tenantId: tenant.id, allBranches: true },
      { userId: c1.id, tenantId: tenant.id },
      { userId: c2.id, tenantId: tenant.id },
      { userId: c3.id, tenantId: tenant.id },
      { userId: inactiveUser.id, tenantId: tenant.id },
    ],
  });
  await prisma.userRole.createMany({
    data: [
      { userId: platform.id, roleId: platRole.id },
      { userId: owner.id, roleId: ownerRole.id },
      { userId: manager.id, roleId: mgrRole.id },
      { userId: c1.id, roleId: cashRole.id },
      { userId: c2.id, roleId: cashRole.id },
      { userId: c3.id, roleId: cashRole.id },
      { userId: inactiveUser.id, roleId: cashRole.id },
    ],
  });
  await prisma.userBranch.createMany({
    data: [
      { userId: owner.id, branchId: dhk.id },
      { userId: owner.id, branchId: utt.id },
      { userId: manager.id, branchId: dhk.id },
      { userId: manager.id, branchId: utt.id },
      { userId: c1.id, branchId: dhk.id },
      { userId: c2.id, branchId: utt.id },
      { userId: c3.id, branchId: dhk.id },
      { userId: inactiveUser.id, branchId: dhk.id },
    ],
  });

  const regDhk = await prisma.register.create({
    data: { tenantId: tenant.id, branchId: dhk.id, name: "Register 01" },
  });
  const regDhk2 = await prisma.register.create({
    data: { tenantId: tenant.id, branchId: dhk.id, name: "Register 02" },
  });
  const regUtt = await prisma.register.create({
    data: { tenantId: tenant.id, branchId: utt.id, name: "Register 01" },
  });
  await prisma.tillDevice.createMany({
    data: [
      { registerId: regDhk.id, hardwareId: "DHK-TILL-01", name: "Dhanmondi Till 1" },
      { registerId: regDhk2.id, hardwareId: "DHK-TILL-02", name: "Dhanmondi Till 2" },
      { registerId: regUtt.id, hardwareId: "UTT-TILL-01", name: "Uttara Till 1" },
    ],
  });

  const vat = await prisma.taxCategory.create({
    data: { tenantId: tenant.id, name: "VAT 5%", rate: "5" },
  });
  await prisma.taxCategory.create({
    data: { tenantId: tenant.id, name: "VAT 15%", rate: "15" },
  });
  await prisma.taxCategory.create({
    data: { tenantId: tenant.id, name: "Zero rated", rate: "0" },
  });

  const women = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Women", slug: "women", sortOrder: 1 },
  });
  const men = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Men", slug: "men", sortOrder: 2 },
  });
  const kids = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Kids", slug: "kids", sortOrder: 3 },
  });
  const accessories = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Accessories", slug: "accessories", sortOrder: 4 },
  });
  const services = await prisma.category.create({
    data: { tenantId: tenant.id, name: "Services", slug: "services", sortOrder: 5 },
  });
  const kurtaSub = await prisma.subcategory.create({
    data: { tenantId: tenant.id, categoryId: women.id, name: "Kurta", slug: "kurta", sortOrder: 1 },
  });
  const scarfSub = await prisma.subcategory.create({
    data: { tenantId: tenant.id, categoryId: women.id, name: "Scarf", slug: "scarf", sortOrder: 2 },
  });
  const shirtSub = await prisma.subcategory.create({
    data: { tenantId: tenant.id, categoryId: men.id, name: "Shirts", slug: "shirts", sortOrder: 1 },
  });
  const teeSub = await prisma.subcategory.create({
    data: { tenantId: tenant.id, categoryId: kids.id, name: "Tees", slug: "tees", sortOrder: 1 },
  });
  const bagsSub = await prisma.subcategory.create({
    data: { tenantId: tenant.id, categoryId: accessories.id, name: "Bags", slug: "bags", sortOrder: 1 },
  });
  await prisma.subcategory.create({
    data: { tenantId: tenant.id, categoryId: services.id, name: "In-store", slug: "in-store" },
  });

  const brand = await prisma.brand.create({ data: { tenantId: tenant.id, name: "Nokshi" } });
  const brandHome = await prisma.brand.create({ data: { tenantId: tenant.id, name: "Nokshi Home" } });
  await prisma.brand.create({ data: { tenantId: tenant.id, name: "Guest Label", status: "INACTIVE" } });

  const pcs = await prisma.unit.create({
    data: { tenantId: tenant.id, name: "Piece", abbreviation: "pcs", sortOrder: 1 },
  });
  await prisma.unit.createMany({
    data: [
      { tenantId: tenant.id, name: "Kilogram", abbreviation: "kg", sortOrder: 2 },
      { tenantId: tenant.id, name: "Gram", abbreviation: "g", sortOrder: 3 },
      { tenantId: tenant.id, name: "Liter", abbreviation: "L", sortOrder: 4 },
      { tenantId: tenant.id, name: "Milliliter", abbreviation: "ml", sortOrder: 5 },
      { tenantId: tenant.id, name: "Meter", abbreviation: "m", sortOrder: 6 },
      { tenantId: tenant.id, name: "Pair", abbreviation: "pair", sortOrder: 7 },
      { tenantId: tenant.id, name: "Box", abbreviation: "box", sortOrder: 8 },
      { tenantId: tenant.id, name: "Pack", abbreviation: "pack", sortOrder: 9 },
      { tenantId: tenant.id, name: "Dozen", abbreviation: "doz", sortOrder: 10 },
      { tenantId: tenant.id, name: "Bottle", abbreviation: "btl", sortOrder: 11 },
      { tenantId: tenant.id, name: "Carton", abbreviation: "ctn", sortOrder: 12 },
      { tenantId: tenant.id, name: "Roll", abbreviation: "roll", sortOrder: 13 },
      { tenantId: tenant.id, name: "Set", abbreviation: "set", sortOrder: 14 },
      { tenantId: tenant.id, name: "Ton", abbreviation: "ton", sortOrder: 15 },
      { tenantId: tenant.id, name: "Centimeter", abbreviation: "cm", sortOrder: 16 },
    ],
  });

  const colour = await prisma.attributeDefinition.create({
    data: {
      tenantId: tenant.id,
      key: "colour",
      name: "Colour",
      dataType: "SELECT",
      variantDefining: true,
      sortOrder: 1,
    },
  });
  const size = await prisma.attributeDefinition.create({
    data: {
      tenantId: tenant.id,
      key: "size",
      name: "Size",
      dataType: "SELECT",
      variantDefining: true,
      sortOrder: 2,
    },
  });
  const fit = await prisma.attributeDefinition.create({
    data: {
      tenantId: tenant.id,
      key: "fit",
      name: "Fit",
      dataType: "SELECT",
      variantDefining: false,
      sortOrder: 3,
    },
  });

  const colours = await Promise.all(
    [
      ["red", "Red"],
      ["navy", "Navy"],
      ["black", "Black"],
      ["olive", "Olive"],
      ["cream", "Cream"],
    ].map(([value, label], i) =>
      prisma.attributeOption.create({
        data: { definitionId: colour.id, value, label, sortOrder: i },
      }),
    ),
  );
  const sizes = await Promise.all(
    [
      ["s", "S"],
      ["m", "M"],
      ["l", "L"],
      ["xl", "XL"],
    ].map(([value, label], i) =>
      prisma.attributeOption.create({
        data: { definitionId: size.id, value, label, sortOrder: i },
      }),
    ),
  );
  await prisma.attributeOption.createMany({
    data: [
      { definitionId: fit.id, value: "regular", label: "Regular", sortOrder: 0 },
      { definitionId: fit.id, value: "slim", label: "Slim", sortOrder: 1 },
      { definitionId: fit.id, value: "relaxed", label: "Relaxed", sortOrder: 2 },
    ],
  });

  for (const [key, name, values, sortOrder] of [
    ["weight", "Weight", [["250g", "250 g"], ["500g", "500 g"], ["1kg", "1 kg"]], 4],
    ["volume", "Volume", [["250ml", "250 ml"], ["500ml", "500 ml"], ["1l", "1 L"]], 5],
    ["material", "Material", [["cotton", "Cotton"], ["silk", "Silk"], ["linen", "Linen"]], 6],
  ] as [string, string, [string, string][], number][]) {
    const def = await prisma.attributeDefinition.create({
      data: {
        tenantId: tenant.id,
        key,
        name,
        dataType: "SELECT",
        variantDefining: true,
        sortOrder,
      },
    });
    await prisma.attributeOption.createMany({
      data: values.map(([value, label], i) => ({ definitionId: def.id, value, label, sortOrder: i })),
    });
  }

  const mills = await prisma.supplier.create({
    data: {
      tenantId: tenant.id,
      name: "Dhaka Textile Mills",
      phone: "+8801800000001",
      email: "sales@dtm.example",
      address: "Tejgaon, Dhaka",
      taxId: "BIN-88990011",
      creditDue: "18500",
    },
  });
  const trims = await prisma.supplier.create({
    data: {
      tenantId: tenant.id,
      name: "Chittagong Trims Ltd",
      phone: "+8801800000002",
      email: "order@ctrims.example",
      address: "CEPZ, Chittagong",
      creditDue: "4200",
    },
  });
  await prisma.supplier.create({
    data: {
      tenantId: tenant.id,
      name: "Inactive Yarn Co",
      phone: "+8801800000003",
      status: "INACTIVE",
      notes: "Do not reorder",
    },
  });

  const kurta = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      name: "Cotton Kurta",
      code: "KURTA-01",
      type: "VARIABLE",
      category: "Women",
      categoryId: women.id,
      subcategoryId: kurtaSub.id,
      brandId: brand.id,
      unitId: pcs.id,
      taxCategoryId: vat.id,
      supplierId: mills.id,
      description: "Handloom cotton kurta with side slits.",
      tags: "kurta,cotton,eid",
      featured: true,
      posSaleEnabled: true,
      onlineSaleEnabled: true,
      trackInventory: true,
      sellingPrice: "1890",
      purchasePrice: "850",
      wholesalePrice: "1450",
      retailPrice: "1890",
      minStock: "4",
      reorderLevel: "6",
    },
  });
  const shirt = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      name: "Oxford Shirt",
      code: "SHIRT-01",
      type: "VARIABLE",
      category: "Men",
      categoryId: men.id,
      subcategoryId: shirtSub.id,
      brandId: brand.id,
      unitId: pcs.id,
      taxCategoryId: vat.id,
      supplierId: mills.id,
      description: "Classic oxford shirt, button-down collar.",
      tags: "shirt,men,office",
      posSaleEnabled: true,
      onlineSaleEnabled: true,
      trackInventory: true,
      sellingPrice: "2490",
      purchasePrice: "1120",
      wholesalePrice: "1890",
      retailPrice: "2490",
      minStock: "3",
      reorderLevel: "5",
    },
  });

  let skuN = 1;
  const fashionVariants: VariantPick[] = [];

  async function stockLocations(
    variantId: string,
    unitCost: string,
    qty: { dhk: string; utt: string; wh: string; reserved?: string },
  ) {
    await prisma.stock.createMany({
      data: [
        {
          tenantId: tenant.id,
          locationId: locDhk.id,
          variantId,
          channel: "STORE",
          quantity: qty.dhk,
          reservedQuantity: qty.reserved ?? "0",
          reorderLevel: "5",
          unitCost,
        },
        {
          tenantId: tenant.id,
          locationId: locUtt.id,
          variantId,
          channel: "STORE",
          quantity: qty.utt,
          reorderLevel: "3",
          unitCost,
        },
        {
          tenantId: tenant.id,
          locationId: locWh.id,
          variantId,
          channel: "WAREHOUSE",
          quantity: qty.wh,
          reorderLevel: "20",
          unitCost,
        },
      ],
    });
    await prisma.stockMovement.createMany({
      data: [
        {
          tenantId: tenant.id,
          locationId: locDhk.id,
          variantId,
          type: "OPENING",
          quantity: qty.dhk,
          reason: "Opening balance",
          createdById: owner.id,
        },
        {
          tenantId: tenant.id,
          locationId: locUtt.id,
          variantId,
          type: "OPENING",
          quantity: qty.utt,
          reason: "Opening balance",
          createdById: owner.id,
        },
        {
          tenantId: tenant.id,
          locationId: locWh.id,
          variantId,
          type: "OPENING",
          quantity: qty.wh,
          reason: "Warehouse opening",
          createdById: owner.id,
        },
      ],
    });
  }

  for (const product of [kurta, shirt]) {
    const base = product.id === kurta.id ? 1890 : 2490;
    for (const c of colours) {
      for (const s of sizes) {
        const variantKey = buildVariantKey([
          { key: "colour", value: c.value },
          { key: "size", value: s.value },
        ]);
        const sku = `${product.code}-${c.value}-${s.value}`.toUpperCase();
        const cost = String(Math.round(base * 0.45));
        const v = await prisma.productVariant.create({
          data: {
            tenantId: tenant.id,
            productId: product.id,
            sku,
            variantKey,
            price: String(base),
            cost,
            wholesalePrice: String(Math.round(base * 0.78)),
            retailPrice: String(base),
            unitId: pcs.id,
            minStock: "2",
            weight: "0.35",
          },
        });
        await prisma.variantAttributeValue.createMany({
          data: [
            { variantId: v.id, optionId: c.id },
            { variantId: v.id, optionId: s.id },
          ],
        });
        const code = `890${String(skuN).padStart(10, "0")}`;
        skuN += 1;
        await prisma.barcode.create({
          data: { tenantId: tenant.id, variantId: v.id, code, kind: "EAN13", primary: true },
        });
        const isLow = c.value === "cream" && s.value === "xl";
        const isOut = c.value === "olive" && s.value === "s" && product.id === shirt.id;
        await stockLocations(v.id, cost, {
          dhk: isOut ? "0" : isLow ? "2" : "36",
          utt: isOut ? "1" : isLow ? "2" : "22",
          wh: "80",
          reserved: c.value === "navy" && s.value === "m" ? "3" : "0",
        });
        fashionVariants.push({
          id: v.id,
          sku,
          price: String(base),
          cost,
          productId: product.id,
          productName: product.name,
          snap: `Colour ${c.label} / Size ${s.label}`,
        });
      }
    }
  }

  await prisma.productImage.createMany({
    data: [
      { productId: kurta.id, url: "https://picsum.photos/seed/nokshi-kurta/640/800", alt: "Cotton kurta", isPrimary: true, sortOrder: 0 },
      { productId: shirt.id, url: "https://picsum.photos/seed/nokshi-shirt/640/800", alt: "Oxford shirt", isPrimary: true, sortOrder: 0 },
    ],
  });

  async function createSimple(opts: {
    name: string;
    code: string;
    type: "SIMPLE" | "SERVICE" | "DIGITAL" | "BUNDLE";
    category: string;
    categoryId: string;
    subcategoryId?: string;
    brandId?: string;
    supplierId?: string;
    price: string;
    cost: string;
    featured?: boolean;
    pos?: boolean;
    online?: boolean;
    track?: boolean;
    status?: "ACTIVE" | "DRAFT" | "INACTIVE" | "ARCHIVED";
    description?: string;
    tags?: string;
    qty?: { dhk: string; utt: string; wh: string };
  }): Promise<VariantPick> {
    const product = await prisma.product.create({
      data: {
        tenantId: tenant.id,
        name: opts.name,
        code: opts.code,
        type: opts.type,
        status: opts.status ?? "ACTIVE",
        category: opts.category,
        categoryId: opts.categoryId,
        subcategoryId: opts.subcategoryId,
        brandId: opts.brandId ?? brand.id,
        unitId: pcs.id,
        taxCategoryId: vat.id,
        supplierId: opts.supplierId,
        description: opts.description,
        tags: opts.tags,
        featured: opts.featured ?? false,
        posSaleEnabled: opts.pos ?? true,
        onlineSaleEnabled: opts.online ?? false,
        trackInventory: opts.track ?? (opts.type !== "SERVICE" && opts.type !== "DIGITAL"),
        sellingPrice: opts.price,
        purchasePrice: opts.cost,
        retailPrice: opts.price,
      },
    });
    const v = await prisma.productVariant.create({
      data: {
        tenantId: tenant.id,
        productId: product.id,
        sku: opts.code,
        variantKey: DEFAULT_VARIANT_KEY,
        price: opts.price,
        cost: opts.cost,
        unitId: pcs.id,
        minStock: opts.track === false ? "0" : "4",
      },
    });
    const code = `890${String(skuN).padStart(10, "0")}`;
    skuN += 1;
    await prisma.barcode.create({
      data: { tenantId: tenant.id, variantId: v.id, code, kind: "EAN13", primary: true },
    });
    if (opts.track !== false && opts.type !== "SERVICE" && opts.type !== "DIGITAL") {
      await stockLocations(v.id, opts.cost, opts.qty ?? { dhk: "24", utt: "16", wh: "40" });
    }
    return {
      id: v.id,
      sku: opts.code,
      price: opts.price,
      cost: opts.cost,
      productId: product.id,
      productName: opts.name,
      snap: "Default",
    };
  }

  const tote = await createSimple({
    name: "Lifestyle Tote",
    code: "TOTE-01",
    type: "SIMPLE",
    category: "Accessories",
    categoryId: accessories.id,
    subcategoryId: bagsSub.id,
    brandId: brandHome.id,
    supplierId: trims.id,
    price: "890",
    cost: "320",
    featured: true,
    online: true,
    tags: "bag,tote",
    description: "Canvas tote with Nokshi print.",
  });
  const scarf = await createSimple({
    name: "Silk Scarf",
    code: "SCARF-01",
    type: "SIMPLE",
    category: "Women",
    categoryId: women.id,
    subcategoryId: scarfSub.id,
    price: "1290",
    cost: "480",
    online: true,
    tags: "scarf,silk",
    qty: { dhk: "8", utt: "4", wh: "18" },
  });
  const playTee = await createSimple({
    name: "Play Tee",
    code: "KIDS-TEE-01",
    type: "SIMPLE",
    category: "Kids",
    categoryId: kids.id,
    subcategoryId: teeSub.id,
    price: "690",
    cost: "240",
    qty: { dhk: "3", utt: "2", wh: "12" },
  });
  const wrap = await createSimple({
    name: "Gift Wrap Service",
    code: "SVC-WRAP",
    type: "SERVICE",
    category: "Services",
    categoryId: services.id,
    price: "80",
    cost: "0",
    track: false,
    tags: "service",
  });
  const careCard = await createSimple({
    name: "Wash Care Card",
    code: "DGT-CARE",
    type: "DIGITAL",
    category: "Services",
    categoryId: services.id,
    price: "0",
    cost: "0",
    track: false,
    pos: false,
    online: true,
  });
  const bundle = await createSimple({
    name: "Wedding Gift Set",
    code: "BND-WED-01",
    type: "BUNDLE",
    category: "Accessories",
    categoryId: accessories.id,
    price: "2590",
    cost: "1170",
    featured: true,
    track: false,
    description: "Kurta + tote bundle.",
  });
  await prisma.productBundleItem.createMany({
    data: [
      { bundleProductId: bundle.productId, variantId: fashionVariants[0].id, qty: "1" },
      { bundleProductId: bundle.productId, variantId: tote.id, qty: "1" },
    ],
  });
  await createSimple({
    name: "Sample Muslin Swatch",
    code: "ARCH-SWATCH",
    type: "SIMPLE",
    category: "Accessories",
    categoryId: accessories.id,
    price: "10",
    cost: "2",
    status: "ARCHIVED",
    pos: false,
    track: false,
  });
  await createSimple({
    name: "Upcoming Linen Shirt",
    code: "DRAFT-LINEN",
    type: "SIMPLE",
    category: "Men",
    categoryId: men.id,
    price: "2790",
    cost: "1300",
    status: "DRAFT",
    pos: false,
    track: false,
  });

  const ayesha = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: "Ayesha Rahman",
      phone: "+8801711000001",
      phoneCanonical: "+8801711000001",
      email: "ayesha@example.com",
      address: "Lalmatia, Dhaka",
      loyaltyPoints: 420,
      creditLimit: "20000",
      creditDue: "3500",
      birthday: new Date(`${YEAR}-03-12`),
    },
  });
  const farhan = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: "Farhan Islam",
      phone: "+8801711000002",
      phoneCanonical: "+8801711000002",
      email: "farhan@example.com",
      address: "Uttara Sector 7",
      loyaltyPoints: 80,
      creditLimit: "10000",
      creditDue: "0",
    },
  });
  const corp = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      type: "BUSINESS",
      name: "Studio Noon Ltd",
      phone: "+8801711000003",
      phoneCanonical: "+8801711000003",
      email: "accounts@studionoon.example",
      address: "Gulshan 2, Dhaka",
      taxId: "BIN-11223344",
      loyaltyPoints: 0,
      creditLimit: "80000",
      creditDue: "12500",
      notes: "Net-15 wholesale",
    },
  });
  const nabila = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: "Nabila Chowdhury",
      phone: "+8801711000004",
      phoneCanonical: "+8801711000004",
      email: "nabila@example.com",
      loyaltyPoints: 15,
      creditLimit: "5000",
    },
  });
  await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: "Old Walk-in",
      phone: "+8801711000099",
      phoneCanonical: "+8801711000099",
      status: "INACTIVE",
      notes: "Duplicate number retired",
    },
  });
  const rafi = await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: "Rafi Hasan",
      phone: "+8801711000005",
      phoneCanonical: "+8801711000005",
      loyaltyPoints: 210,
      creditLimit: "15000",
      creditDue: "900",
    },
  });

  await prisma.shiftTemplate.createMany({
    data: [
      {
        tenantId: tenant.id,
        name: "Morning",
        startTime: "09:00",
        endTime: "17:00",
        days: ["SAT", "SUN", "MON", "TUE", "WED", "THU"],
      },
      {
        tenantId: tenant.id,
        name: "Evening",
        startTime: "16:00",
        endTime: "22:00",
        days: ["SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"],
      },
      {
        tenantId: tenant.id,
        name: "Friday weekend",
        startTime: "10:00",
        endTime: "20:00",
        days: ["FRI"],
      },
    ],
  });

  for (let i = 1; i <= 7; i++) {
    const workDate = bizDate(i);
    await prisma.attendance.createMany({
      data: [
        {
          tenantId: tenant.id,
          userId: c1.id,
          branchId: dhk.id,
          status: i === 3 ? "LATE" : "PRESENT",
          workDate,
          checkIn: atHour(workDate, i === 3 ? 10 : 9, i === 3 ? 12 : 5),
          checkOut: atHour(workDate, 18, 2),
        },
        {
          tenantId: tenant.id,
          userId: c2.id,
          branchId: utt.id,
          status: i === 5 ? "LEAVE" : "PRESENT",
          workDate,
          checkIn: i === 5 ? null : atHour(workDate, 9, 20),
          checkOut: i === 5 ? null : atHour(workDate, 18, 10),
          notes: i === 5 ? "Casual leave" : null,
        },
        {
          tenantId: tenant.id,
          userId: manager.id,
          branchId: dhk.id,
          status: "PRESENT",
          workDate,
          checkIn: atHour(workDate, 8, 50),
          checkOut: atHour(workDate, 19, 0),
        },
      ],
    });
  }

  async function closedShift(opts: {
    branchId: string;
    registerId: string;
    cashierId: string;
    daysAgo: number;
    opening: string;
    closing: string;
  }) {
    const day = bizDate(opts.daysAgo);
    return prisma.shift.create({
      data: {
        tenantId: tenant.id,
        branchId: opts.branchId,
        registerId: opts.registerId,
        cashierId: opts.cashierId,
        status: "CLOSED",
        businessDate: day,
        openedAt: atHour(day, 9, 0),
        closedAt: atHour(day, 18, 30),
        openingFloat: opts.opening,
        closingCash: opts.closing,
        expectedCash: opts.closing,
      },
    });
  }

  const closedByKey = new Map<string, string>();
  for (const ago of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const dhkClosed = await closedShift({
      branchId: dhk.id,
      registerId: regDhk.id,
      cashierId: c1.id,
      daysAgo: ago,
      opening: "5000",
      closing: String(9000 + ago * 300),
    });
    const uttClosed = await closedShift({
      branchId: utt.id,
      registerId: regUtt.id,
      cashierId: c2.id,
      daysAgo: ago,
      opening: "4000",
      closing: String(7000 + ago * 220),
    });
    closedByKey.set(`c1:${ago}`, dhkClosed.id);
    closedByKey.set(`c2:${ago}`, uttClosed.id);
  }
  const shiftDhkY = { id: closedByKey.get("c1:1")! };
  const shiftUttY = { id: closedByKey.get("c2:1")! };

  const shiftDhkOpen = await prisma.shift.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      registerId: regDhk.id,
      cashierId: c1.id,
      status: "OPEN",
      businessDate: bizDate(0),
      openedAt: atHour(bizDate(0), 9, 0),
      openingFloat: "5000",
    },
  });
  const shiftUttOpen = await prisma.shift.create({
    data: {
      tenantId: tenant.id,
      branchId: utt.id,
      registerId: regUtt.id,
      cashierId: c2.id,
      status: "OPEN",
      businessDate: bizDate(0),
      openedAt: atHour(bizDate(0), 9, 5),
      openingFloat: "4000",
    },
  });

  const bizSnap = {
    name: "Nokshi Lifestyle",
    legalName: "Nokshi Lifestyle Ltd.",
    vatId: "BIN-000123456",
    address: "House 12, Road 7, Dhanmondi, Dhaka 1209",
    phone: "+8801700000000",
  };

  let dhkInv = 1;
  let uttInv = 1;
  let dhkRet = 1;
  let soN = 1;
  let poN = 1;
  let grnN = 1;
  let txN = 1;

  function nextInvoice(code: "DHK" | "UTT") {
    const n = code === "DHK" ? dhkInv++ : uttInv++;
    return `${code}-INV-${YEAR}-${pad(n)}`;
  }

  async function addSale(opts: {
    branch: typeof dhk;
    locationId: string;
    registerId: string;
    cashierId: string;
    shiftId: string;
    customer?: { id: string; name: string; phone: string } | null;
    daysAgo: number;
    hour?: number;
    items: { v: VariantPick; qty: number; discount?: number }[];
    payments: { method: string; amount: string; status?: "CAPTURED" | "REFUNDED" | "FAILED" | "PENDING" | "CANCELLED" }[];
    status?: "COMPLETED" | "VOIDED" | "PARTIALLY_RETURNED" | "FULLY_RETURNED" | "DRAFT";
    channel?: "STORE" | "ONLINE" | "MARKETPLACE";
    moveStock?: boolean;
    deviceId: string;
  }) {
    const businessDate = bizDate(opts.daysAgo);
    const createdAt = atHour(businessDate, opts.hour ?? 11, (txN * 3) % 50);
    const computed = opts.items.map((it) => ({
      it,
      line: lineTotals({
        unitPrice: it.v.price,
        qty: it.qty,
        lineDiscount: it.discount ?? 0,
        taxRatePercent: TAX_RATE,
      }),
    }));
    const totals = invoiceTotals(computed.map((c) => c.line));
    const paid = opts.payments
      .filter((p) => (p.status ?? "CAPTURED") === "CAPTURED")
      .reduce((n, p) => n + Number(p.amount), 0);
    const dueAmt = Math.max(Number(totals.total) - paid, 0);
    const code = opts.branch.code as "DHK" | "UTT";
    const invoiceNumber = nextInvoice(code);
    const sale = await prisma.sale.create({
      data: {
        tenantId: tenant.id,
        branchId: opts.branch.id,
        locationId: opts.locationId,
        registerId: opts.registerId,
        shiftId: opts.shiftId,
        cashierId: opts.cashierId,
        channel: opts.channel ?? "STORE",
        customerId: opts.customer?.id,
        status: opts.status ?? "COMPLETED",
        invoiceNumber,
        businessDate,
        createdAt,
        currency: "BDT",
        subtotal: toMoneyString(totals.subtotal),
        discount: toMoneyString(totals.discount),
        tax: toMoneyString(totals.tax),
        total: toMoneyString(totals.total),
        paid: money(paid),
        due: money(dueAmt),
        change: money(Math.max(paid - Number(totals.total), 0)),
        clientTransactionId: `seed-${code}-${txN++}`,
        deviceId: opts.deviceId,
        deviceSequence: 1,
        businessSnapshot: bizSnap,
        customerSnapshot: opts.customer ? { name: opts.customer.name, phone: opts.customer.phone } : undefined,
        taxRegistrationSnapshot: { vatId: bizSnap.vatId, rateNote: "VAT by line" },
        currencySnapshot: { code: "BDT", rate: "1" },
        items: {
          create: computed.map((c) => ({
            variantId: c.it.v.id,
            qty: String(c.it.qty),
            unitPrice: c.it.v.price,
            originalPrice: c.it.v.price,
            discountAmount: toMoneyString(c.line.discount),
            discountReason: c.it.discount ? "Seed promo" : null,
            taxRate: String(TAX_RATE),
            taxAmount: toMoneyString(c.line.tax),
            lineTotal: toMoneyString(c.line.lineTotal),
            productNameSnapshot: c.it.v.productName,
            skuSnapshot: c.it.v.sku,
            variantSnapshot: c.it.v.snap,
            associateId: opts.cashierId,
          })),
        },
        payments: {
          create: opts.payments.map((p) => ({
            method: p.method,
            provider: "manual",
            status: p.status ?? "CAPTURED",
            amount: p.amount,
          })),
        },
      },
      include: { items: true, payments: true },
    });

    await prisma.saleDocument.createMany({
      data: [
        { saleId: sale.id, kind: "BILL", snapshot: { invoiceNumber, total: sale.total } },
        { saleId: sale.id, kind: "INVOICE", snapshot: { invoiceNumber, total: sale.total, customer: opts.customer?.name } },
      ],
    });
    await prisma.fiscalDocument.create({
      data: {
        tenantId: tenant.id,
        saleId: sale.id,
        status: opts.status === "VOIDED" ? "CANCELLED" : "ISSUED",
        payload: { invoiceNumber, channel: sale.channel },
      },
    });
    await prisma.accountingEvent.create({
      data: {
        tenantId: tenant.id,
        saleId: sale.id,
        type: "SALE_REVENUE",
        payload: { total: sale.total, tax: sale.tax, status: sale.status },
      },
    });
    await prisma.outboxEvent.create({
      data: {
        tenantId: tenant.id,
        type: "SALE_CREATED",
        eventType: "SALE_CREATED",
        aggregateId: sale.id,
        payload: { saleId: sale.id, invoiceNumber },
        correlationId: sale.clientTransactionId,
        processedAt: createdAt,
      },
    });

    const shouldMove =
      opts.moveStock !== false &&
      (opts.status ?? "COMPLETED") !== "VOIDED" &&
      (opts.status ?? "COMPLETED") !== "DRAFT";
    if (shouldMove) {
      for (const it of opts.items) {
        const updated = await prisma.stock.updateMany({
          where: { tenantId: tenant.id, locationId: opts.locationId, variantId: it.v.id },
          data: { quantity: { decrement: it.qty } },
        });
        if (!updated.count) continue;
        await prisma.stockMovement.create({
          data: {
            tenantId: tenant.id,
            locationId: opts.locationId,
            variantId: it.v.id,
            type: "SALE",
            quantity: String(-it.qty),
            saleId: sale.id,
            createdById: opts.cashierId,
          },
        });
      }
    }
    if (opts.customer && dueAmt > 0 && (opts.status ?? "COMPLETED") === "COMPLETED") {
      await prisma.customer.update({
        where: { id: opts.customer.id },
        data: { creditDue: { increment: dueAmt } },
      });
    }
    if (opts.customer && (opts.status ?? "COMPLETED") === "COMPLETED") {
      const pts = Math.floor(Number(totals.total) / 100);
      if (pts > 0) {
        await prisma.loyaltyTransaction.create({
          data: {
            tenantId: tenant.id,
            customerId: opts.customer.id,
            type: "EARN",
            points: pts,
            saleId: sale.id,
            notes: `Earn on ${invoiceNumber}`,
          },
        });
      }
    }
    return sale;
  }

  const k0 = fashionVariants[0];
  const k1 = fashionVariants[1];
  const s0 = fashionVariants.find((v) => v.productName === "Oxford Shirt") ?? fashionVariants[8];
  const s1 = fashionVariants.find((v) => v.productName === "Oxford Shirt" && v.id !== s0.id) ?? fashionVariants[9];

  const saleToday1 = await addSale({
    branch: dhk,
    locationId: locDhk.id,
    registerId: regDhk.id,
    cashierId: c1.id,
    shiftId: shiftDhkOpen.id,
    customer: ayesha,
    daysAgo: 0,
    hour: 10,
    items: [
      { v: k0, qty: 1 },
      { v: wrap, qty: 1 },
    ],
    payments: [{ method: "CASH", amount: money(Number(lineTotals({ unitPrice: k0.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal) + Number(lineTotals({ unitPrice: wrap.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal)) }],
    deviceId: "DHK-TILL-01",
  });
  await addSale({
    branch: dhk,
    locationId: locDhk.id,
    registerId: regDhk.id,
    cashierId: c1.id,
    shiftId: shiftDhkOpen.id,
    customer: nabila,
    daysAgo: 0,
    hour: 12,
    items: [{ v: tote, qty: 2, discount: 50 }],
    payments: [{ method: "CARD", amount: toMoneyString(lineTotals({ unitPrice: tote.price, qty: 2, lineDiscount: 50, taxRatePercent: TAX_RATE }).lineTotal) }],
    deviceId: "DHK-TILL-01",
  });
  await addSale({
    branch: dhk,
    locationId: locDhk.id,
    registerId: regDhk.id,
    cashierId: c1.id,
    shiftId: shiftDhkOpen.id,
    daysAgo: 0,
    hour: 13,
    items: [{ v: s0, qty: 1 }],
    payments: [{ method: "MFS", amount: toMoneyString(lineTotals({ unitPrice: s0.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal) }],
    deviceId: "DHK-TILL-01",
  });
  await addSale({
    branch: utt,
    locationId: locUtt.id,
    registerId: regUtt.id,
    cashierId: c2.id,
    shiftId: shiftUttOpen.id,
    customer: farhan,
    daysAgo: 0,
    hour: 11,
    items: [{ v: k1, qty: 1 }],
    payments: [{ method: "CASH", amount: toMoneyString(lineTotals({ unitPrice: k1.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal) }],
    deviceId: "UTT-TILL-01",
  });

  const dueLine = lineTotals({ unitPrice: s0.price, qty: 2, taxRatePercent: TAX_RATE });
  await addSale({
    branch: dhk,
    locationId: locDhk.id,
    registerId: regDhk.id,
    cashierId: c1.id,
    shiftId: shiftDhkY.id,
    customer: corp,
    daysAgo: 1,
    hour: 15,
    items: [{ v: s0, qty: 2 }],
    payments: [{ method: "BANK", amount: money(Number(dueLine.lineTotal) - 4000) }],
    deviceId: "DHK-TILL-01",
  });

  await addSale({
    branch: dhk,
    locationId: locDhk.id,
    registerId: regDhk.id,
    cashierId: c1.id,
    shiftId: shiftDhkY.id,
    customer: rafi,
    daysAgo: 1,
    hour: 16,
    items: [{ v: scarf, qty: 1 }],
    payments: [{ method: "CASH", amount: toMoneyString(lineTotals({ unitPrice: scarf.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal) }],
    deviceId: "DHK-TILL-01",
  });
  await addSale({
    branch: utt,
    locationId: locUtt.id,
    registerId: regUtt.id,
    cashierId: c2.id,
    shiftId: shiftUttY.id,
    daysAgo: 1,
    hour: 14,
    items: [{ v: playTee, qty: 1 }, { v: tote, qty: 1 }],
    payments: [
      { method: "CASH", amount: "500" },
      { method: "CARD", amount: toMoneyString(Number(lineTotals({ unitPrice: playTee.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal) + Number(lineTotals({ unitPrice: tote.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal) - 500) },
    ],
    deviceId: "UTT-TILL-01",
  });

  const voidSale = await addSale({
    branch: dhk,
    locationId: locDhk.id,
    registerId: regDhk.id,
    cashierId: c1.id,
    shiftId: shiftDhkY.id,
    daysAgo: 1,
    hour: 17,
    items: [{ v: k0, qty: 1 }],
        payments: [{ method: "CASH", amount: toMoneyString(lineTotals({ unitPrice: k0.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal), status: "CANCELLED" }],
    status: "VOIDED",
    moveStock: false,
    deviceId: "DHK-TILL-01",
  });
  void voidSale;

  const partialSrc = await addSale({
    branch: dhk,
    locationId: locDhk.id,
    registerId: regDhk.id,
    cashierId: c1.id,
    shiftId: closedByKey.get("c1:2")!,
    customer: ayesha,
    daysAgo: 2,
    hour: 12,
    items: [
      { v: k0, qty: 2 },
      { v: tote, qty: 1 },
    ],
    payments: [
      {
        method: "CARD",
        amount: toMoneyString(
          Number(lineTotals({ unitPrice: k0.price, qty: 2, taxRatePercent: TAX_RATE }).lineTotal) +
            Number(lineTotals({ unitPrice: tote.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal),
        ),
      },
    ],
    deviceId: "DHK-TILL-01",
  });

  const fullSrc = await addSale({
    branch: utt,
    locationId: locUtt.id,
    registerId: regUtt.id,
    cashierId: c2.id,
    shiftId: closedByKey.get("c2:3")!,
    customer: farhan,
    daysAgo: 3,
    hour: 13,
    items: [{ v: scarf, qty: 1 }],
    payments: [{ method: "CASH", amount: toMoneyString(lineTotals({ unitPrice: scarf.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal) }],
    deviceId: "UTT-TILL-01",
  });

  for (let ago = 4; ago <= 12; ago++) {
    const dhkShiftId = closedByKey.get(`c1:${ago}`);
    const uttShiftId = closedByKey.get(`c2:${ago}`);
    const vPick = fashionVariants[ago % fashionVariants.length];
    if (dhkShiftId) {
      const line = lineTotals({ unitPrice: vPick.price, qty: 1, taxRatePercent: TAX_RATE });
      await addSale({
        branch: dhk,
        locationId: locDhk.id,
        registerId: regDhk.id,
        cashierId: c1.id,
        shiftId: dhkShiftId,
        customer: ago % 2 === 0 ? ayesha : ago % 3 === 0 ? rafi : null,
        daysAgo: ago,
        hour: 11,
        items: [{ v: vPick, qty: 1, discount: ago === 6 ? 100 : 0 }],
        payments: [{ method: ago % 2 === 0 ? "CASH" : ago % 3 === 0 ? "CARD" : "MFS", amount: toMoneyString(line.lineTotal) }],
        deviceId: "DHK-TILL-01",
      });
    }
    if (uttShiftId && ago % 2 === 0) {
      const line = lineTotals({ unitPrice: tote.price, qty: 1, taxRatePercent: TAX_RATE });
      await addSale({
        branch: utt,
        locationId: locUtt.id,
        registerId: regUtt.id,
        cashierId: c2.id,
        shiftId: uttShiftId,
        customer: nabila,
        daysAgo: ago,
        hour: 15,
        items: [{ v: tote, qty: 1 }],
        payments: [{ method: "CASH", amount: toMoneyString(line.lineTotal) }],
        deviceId: "UTT-TILL-01",
      });
    }
  }

  const onlineLine = lineTotals({ unitPrice: k1.price, qty: 1, taxRatePercent: TAX_RATE });
  await addSale({
    branch: dhk,
    locationId: locDhk.id,
    registerId: regDhk.id,
    cashierId: c1.id,
    shiftId: shiftDhkY.id,
    customer: nabila,
    daysAgo: 1,
    hour: 20,
    items: [{ v: k1, qty: 1 }],
    payments: [{ method: "MFS", amount: toMoneyString(onlineLine.lineTotal) }],
    channel: "ONLINE",
    deviceId: "WEB-01",
  });
  await addSale({
    branch: utt,
    locationId: locUtt.id,
    registerId: regUtt.id,
    cashierId: c2.id,
    shiftId: shiftUttY.id,
    customer: farhan,
    daysAgo: 2,
    hour: 19,
    items: [{ v: tote, qty: 1 }],
    payments: [{ method: "CARD", amount: toMoneyString(lineTotals({ unitPrice: tote.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal) }],
    channel: "MARKETPLACE",
    deviceId: "DARAZ-01",
  });

  const retPartialItem = partialSrc.items.find((i) => i.variantId === k0.id)!;
  const retQty = 1;
  const retRefund = lineTotals({ unitPrice: k0.price, qty: retQty, taxRatePercent: TAX_RATE }).lineTotal;
  const retPartial = await prisma.saleReturn.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      saleId: partialSrc.id,
      number: `DHK-RET-${YEAR}-${pad(dhkRet++)}`,
      kind: "RETURN",
      status: "COMPLETED",
      reason: "Size too small",
      notes: "Exchanged advice given",
      refundMethod: "CARD",
      refundAmount: toMoneyString(retRefund),
      restock: true,
      createdById: manager.id,
      approvedById: manager.id,
      createdAt: atHour(bizDate(1), 11),
      postedAt: atHour(bizDate(1), 11, 20),
      items: {
        create: {
          saleItemId: retPartialItem.id,
          variantId: k0.id,
          qty: String(retQty),
          lineRefund: toMoneyString(retRefund),
          restock: true,
          reason: "Wrong size",
        },
      },
    },
  });
  await prisma.paymentTransaction.create({
    data: {
      saleId: partialSrc.id,
      saleReturnId: retPartial.id,
      method: "CARD",
      status: "REFUNDED",
      amount: toMoneyString(retRefund),
    },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locDhk.id, variantId: k0.id },
    data: { quantity: { increment: retQty } },
  });
  await prisma.stockMovement.create({
    data: {
      tenantId: tenant.id,
      locationId: locDhk.id,
      variantId: k0.id,
      type: "SALE_RETURN",
      quantity: String(retQty),
      saleId: partialSrc.id,
      referenceType: "SaleReturn",
      referenceId: retPartial.id,
      createdById: manager.id,
    },
  });
  await prisma.sale.update({
    where: { id: partialSrc.id },
    data: { status: "PARTIALLY_RETURNED" },
  });

  const fullItem = fullSrc.items[0];
  const fullRefund = fullSrc.total;
  const retFull = await prisma.saleReturn.create({
    data: {
      tenantId: tenant.id,
      branchId: utt.id,
      saleId: fullSrc.id,
      number: `UTT-RET-${YEAR}-${pad(1)}`,
      kind: "RETURN",
      status: "COMPLETED",
      reason: "Changed mind",
      refundMethod: "CASH",
      refundAmount: String(fullRefund),
      restock: true,
      createdById: c2.id,
      approvedById: manager.id,
      postedAt: atHour(bizDate(2), 16),
      items: {
        create: {
          saleItemId: fullItem.id,
          variantId: scarf.id,
          qty: "1",
          lineRefund: String(fullRefund),
          restock: true,
        },
      },
    },
  });
  await prisma.paymentTransaction.create({
    data: {
      saleId: fullSrc.id,
      saleReturnId: retFull.id,
      method: "CASH",
      status: "REFUNDED",
      amount: String(fullRefund),
    },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locUtt.id, variantId: scarf.id },
    data: { quantity: { increment: 1 } },
  });
  await prisma.stockMovement.create({
    data: {
      tenantId: tenant.id,
      locationId: locUtt.id,
      variantId: scarf.id,
      type: "SALE_RETURN",
      quantity: "1",
      saleId: fullSrc.id,
      referenceType: "SaleReturn",
      referenceId: retFull.id,
      createdById: c2.id,
    },
  });
  await prisma.sale.update({ where: { id: fullSrc.id }, data: { status: "FULLY_RETURNED" } });

  await prisma.saleReturn.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      saleId: saleToday1.id,
      number: `DHK-RET-${YEAR}-${pad(dhkRet++)}`,
      kind: "RETURN",
      status: "PENDING",
      reason: "Stitch defect",
      notes: "Waiting manager approval",
      restock: true,
      createdById: c1.id,
      items: {
        create: {
          saleItemId: saleToday1.items[0].id,
          variantId: saleToday1.items[0].variantId,
          qty: "1",
          lineRefund: String(saleToday1.items[0].lineTotal),
          restock: true,
        },
      },
    },
  });

  const xSale = await addSale({
    branch: dhk,
    locationId: locDhk.id,
    registerId: regDhk.id,
    cashierId: c1.id,
    shiftId: shiftDhkY.id,
    customer: rafi,
    daysAgo: 1,
    hour: 18,
    items: [{ v: k1, qty: 1 }],
    payments: [{ method: "CASH", amount: toMoneyString(lineTotals({ unitPrice: k1.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal) }],
    deviceId: "DHK-TILL-01",
  });
  const xRefund = lineTotals({ unitPrice: k1.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal;
  const xNew = lineTotals({ unitPrice: k0.price, qty: 1, taxRatePercent: TAX_RATE }).lineTotal;
  await prisma.saleReturn.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      saleId: xSale.id,
      number: `DHK-RET-${YEAR}-${pad(dhkRet++)}`,
      kind: "EXCHANGE",
      status: "COMPLETED",
      reason: "Colour preference",
      refundAmount: "0",
      exchangeAmount: toMoneyString(xNew),
      restock: true,
      createdById: manager.id,
      approvedById: manager.id,
      postedAt: atHour(bizDate(1), 18, 40),
      items: {
        create: {
          saleItemId: xSale.items[0].id,
          variantId: k1.id,
          qty: "1",
          lineRefund: toMoneyString(xRefund),
          restock: true,
        },
      },
      exchangeItems: {
        create: {
          variantId: k0.id,
          qty: "1",
          unitPrice: k0.price,
          lineTotal: toMoneyString(xNew),
        },
      },
    },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locDhk.id, variantId: k1.id },
    data: { quantity: { increment: 1 } },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locDhk.id, variantId: k0.id },
    data: { quantity: { decrement: 1 } },
  });

  await prisma.heldSale.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      cashierId: c1.id,
      payload: {
        cart: [
          {
            variantId: s1.id,
            productId: s1.productId,
            name: s1.productName,
            variantLabel: s1.snap,
            sku: s1.sku,
            unitPrice: s1.price,
            qty: 1,
            discountAmount: "0",
          },
        ],
        customer: { id: nabila.id, name: nabila.name, phone: nabila.phone },
      },
    },
  });

  const poReceived = await prisma.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      supplierId: mills.id,
      status: "RECEIVED",
      number: `DHK-PO-${YEAR}-${pad(poN++)}`,
      notes: "Eid replenishment",
      expectedAt: bizDate(8),
      subtotal: "85000",
      tax: "4250",
      total: "89250",
      createdById: owner.id,
      createdAt: atHour(bizDate(10), 11),
      items: {
        create: [
          { variantId: k0.id, qty: "40", receivedQty: "40", unitCost: "850", taxRate: "5", lineTotal: "35700" },
          { variantId: s0.id, qty: "30", receivedQty: "30", unitCost: "1120", taxRate: "5", lineTotal: "35280" },
        ],
      },
    },
  });
  const poPartial = await prisma.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      branchId: utt.id,
      supplierId: mills.id,
      status: "PARTIAL",
      number: `UTT-PO-${YEAR}-${pad(1)}`,
      notes: "Partial shipment",
      expectedAt: bizDate(-2),
      subtotal: "17000",
      tax: "850",
      total: "17850",
      createdById: manager.id,
      items: {
        create: [{ variantId: k1.id, qty: "20", receivedQty: "8", unitCost: "850", taxRate: "5", lineTotal: "17850" }],
      },
    },
  });
  await prisma.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      supplierId: trims.id,
      status: "ORDERED",
      number: `DHK-PO-${YEAR}-${pad(poN++)}`,
      notes: "Tote restock",
      expectedAt: bizDate(-5),
      subtotal: "6400",
      tax: "320",
      total: "6720",
      createdById: manager.id,
      items: {
        create: [{ variantId: tote.id, qty: "20", unitCost: "320", taxRate: "5", lineTotal: "6720" }],
      },
    },
  });
  await prisma.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      supplierId: mills.id,
      status: "DRAFT",
      number: `DHK-PO-${YEAR}-${pad(poN++)}`,
      notes: "Not submitted",
      subtotal: "0",
      total: "0",
      createdById: owner.id,
    },
  });
  await prisma.purchaseOrder.create({
    data: {
      tenantId: tenant.id,
      branchId: utt.id,
      supplierId: trims.id,
      status: "CANCELLED",
      number: `UTT-PO-${YEAR}-${pad(2)}`,
      notes: "Supplier delay — cancelled",
      subtotal: "2400",
      total: "2520",
      createdById: manager.id,
    },
  });

  const purchase1 = await prisma.purchase.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      locationId: locDhk.id,
      supplierId: mills.id,
      purchaseOrderId: poReceived.id,
      status: "RECEIVED",
      invoiceNumber: `DHK-GRN-${YEAR}-${pad(grnN++)}`,
      businessDate: bizDate(8),
      subtotal: "85000",
      tax: "4250",
      total: "89250",
      paid: "70000",
      due: "19250",
      notes: "Against PO Eid",
      createdById: owner.id,
      items: {
        create: [
          { variantId: k0.id, qty: "40", unitCost: "850", taxRate: "5", taxAmount: "1700", lineTotal: "35700" },
          { variantId: s0.id, qty: "30", unitCost: "1120", taxRate: "5", taxAmount: "1680", lineTotal: "35280" },
        ],
      },
    },
    include: { items: true },
  });
  await prisma.purchase.create({
    data: {
      tenantId: tenant.id,
      branchId: utt.id,
      locationId: locUtt.id,
      supplierId: mills.id,
      purchaseOrderId: poPartial.id,
      status: "RECEIVED",
      invoiceNumber: `UTT-GRN-${YEAR}-${pad(1)}`,
      businessDate: bizDate(3),
      subtotal: "6800",
      tax: "340",
      total: "7140",
      paid: "7140",
      due: "0",
      createdById: manager.id,
      items: {
        create: [{ variantId: k1.id, qty: "8", unitCost: "850", taxRate: "5", taxAmount: "340", lineTotal: "7140" }],
      },
    },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locDhk.id, variantId: k0.id },
    data: { quantity: { increment: 40 } },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locDhk.id, variantId: s0.id },
    data: { quantity: { increment: 30 } },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locUtt.id, variantId: k1.id },
    data: { quantity: { increment: 8 } },
  });
  await prisma.stockMovement.createMany({
    data: [
      { tenantId: tenant.id, locationId: locDhk.id, variantId: k0.id, type: "PURCHASE", quantity: "40", referenceType: "Purchase", referenceId: purchase1.id, createdById: owner.id },
      { tenantId: tenant.id, locationId: locDhk.id, variantId: s0.id, type: "PURCHASE", quantity: "30", referenceType: "Purchase", referenceId: purchase1.id, createdById: owner.id },
    ],
  });

  const prItem = purchase1.items[0];
  const pRet = await prisma.purchaseReturn.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      purchaseId: purchase1.id,
      number: `DHK-PRT-${YEAR}-${pad(1)}`,
      reason: "Damaged carton",
      notes: "3 kurtas wet",
      total: "2677.5",
      createdById: owner.id,
      items: {
        create: {
          purchaseItemId: prItem.id,
          variantId: k0.id,
          qty: "3",
          unitCost: "850",
          lineTotal: "2677.5",
        },
      },
    },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locDhk.id, variantId: k0.id },
    data: { quantity: { decrement: 3 } },
  });
  await prisma.stockMovement.create({
    data: {
      tenantId: tenant.id,
      locationId: locDhk.id,
      variantId: k0.id,
      type: "PURCHASE_RETURN",
      quantity: "-3",
      referenceType: "PurchaseReturn",
      referenceId: pRet.id,
      createdById: owner.id,
    },
  });

  await prisma.stockMovement.create({
    data: {
      tenantId: tenant.id,
      locationId: locWh.id,
      variantId: tote.id,
      type: "TRANSFER_OUT",
      quantity: "-10",
      reason: "Replenish Dhanmondi",
      createdById: manager.id,
    },
  });
  await prisma.stockMovement.create({
    data: {
      tenantId: tenant.id,
      locationId: locDhk.id,
      variantId: tote.id,
      type: "TRANSFER_IN",
      quantity: "10",
      reason: "From warehouse",
      createdById: manager.id,
    },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locWh.id, variantId: tote.id },
    data: { quantity: { decrement: 10 } },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locDhk.id, variantId: tote.id },
    data: { quantity: { increment: 10 } },
  });

  const take = await prisma.stockTake.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      locationId: locDhk.id,
      status: "POSTED",
      notes: "Spot count kurtas",
      createdById: manager.id,
      postedById: owner.id,
      postedAt: atHour(bizDate(2), 8),
      lines: {
        create: [
          { variantId: k0.id, systemQty: "36", countedQty: "35", variance: "-1" },
          { variantId: tote.id, systemQty: "24", countedQty: "24", variance: "0" },
        ],
      },
    },
  });
  await prisma.stock.updateMany({
    where: { tenantId: tenant.id, locationId: locDhk.id, variantId: k0.id },
    data: { quantity: { decrement: 1 } },
  });
  await prisma.stockMovement.create({
    data: {
      tenantId: tenant.id,
      locationId: locDhk.id,
      variantId: k0.id,
      type: "ADJUSTMENT",
      quantity: "-1",
      reason: "Stock take variance",
      referenceType: "StockTake",
      referenceId: take.id,
      createdById: owner.id,
    },
  });
  await prisma.stockTake.create({
    data: {
      tenantId: tenant.id,
      branchId: utt.id,
      locationId: locUtt.id,
      status: "DRAFT",
      notes: "In progress",
      createdById: c2.id,
      lines: {
        create: [{ variantId: playTee.id, systemQty: "2", countedQty: "2", variance: "0" }],
      },
    },
  });

  const rent = await prisma.expenseCategory.create({ data: { tenantId: tenant.id, name: "Rent" } });
  const utilities = await prisma.expenseCategory.create({ data: { tenantId: tenant.id, name: "Utilities" } });
  const salaries = await prisma.expenseCategory.create({ data: { tenantId: tenant.id, name: "Salaries" } });
  const marketing = await prisma.expenseCategory.create({ data: { tenantId: tenant.id, name: "Marketing" } });
  const logistics = await prisma.expenseCategory.create({ data: { tenantId: tenant.id, name: "Logistics" } });
  await prisma.expense.createMany({
    data: [
      { tenantId: tenant.id, branchId: dhk.id, categoryId: rent.id, amount: "45000", method: "BANK", vendor: "Landlord", notes: "Shop rent", businessDate: bizDate(2), createdById: owner.id },
      { tenantId: tenant.id, branchId: utt.id, categoryId: rent.id, amount: "32000", method: "BANK", vendor: "Uttara landlord", notes: "Shop rent", businessDate: bizDate(2), createdById: owner.id },
      { tenantId: tenant.id, branchId: dhk.id, categoryId: utilities.id, amount: "6800", method: "MFS", vendor: "DESCO", notes: "Electricity", businessDate: bizDate(5), createdById: manager.id },
      { tenantId: tenant.id, branchId: dhk.id, categoryId: salaries.id, amount: "28000", method: "BANK", vendor: "Payroll", notes: "Cashier salary", businessDate: bizDate(1), createdById: owner.id },
      { tenantId: tenant.id, branchId: dhk.id, categoryId: marketing.id, amount: "4500", tax: "225", method: "CASH", vendor: "Facebook Ads", notes: "Boost posts", businessDate: bizDate(4), createdById: manager.id },
      { tenantId: tenant.id, branchId: dhk.id, categoryId: logistics.id, amount: "1200", method: "CASH", vendor: "Pathao", notes: "Last-mile", businessDate: bizDate(0), createdById: c1.id },
      { tenantId: tenant.id, branchId: dhk.id, categoryId: marketing.id, status: "DRAFT", amount: "2000", method: "CASH", vendor: "Leaflet print", notes: "Not posted", businessDate: bizDate(0), createdById: manager.id },
    ],
  });
  await prisma.income.createMany({
    data: [
      { tenantId: tenant.id, branchId: dhk.id, category: "Alteration", amount: "450", method: "CASH", notes: "Hemming", businessDate: bizDate(0), createdById: c1.id },
      { tenantId: tenant.id, branchId: dhk.id, category: "Delivery fee", amount: "80", method: "CASH", notes: "Same-day", businessDate: bizDate(1), createdById: c1.id },
      { tenantId: tenant.id, branchId: utt.id, category: "Wholesale overlay", amount: "2500", method: "BANK", notes: "Studio Noon extra", businessDate: bizDate(3), createdById: manager.id },
    ],
  });

  await prisma.ledgerPayment.createMany({
    data: [
      {
        tenantId: tenant.id,
        branchId: dhk.id,
        partyType: "CUSTOMER",
        partyId: ayesha.id,
        direction: "IN",
        amount: "1500",
        method: "CASH",
        reference: "DUE-AYESHA-1",
        notes: "Partial collection",
        businessDate: bizDate(1),
        createdById: c1.id,
      },
      {
        tenantId: tenant.id,
        branchId: dhk.id,
        partyType: "CUSTOMER",
        partyId: corp.id,
        direction: "IN",
        amount: "5000",
        method: "BANK",
        reference: "TRX-NOON-09",
        notes: "Wholesale collection",
        businessDate: bizDate(0),
        createdById: owner.id,
      },
      {
        tenantId: tenant.id,
        branchId: dhk.id,
        partyType: "SUPPLIER",
        partyId: mills.id,
        direction: "OUT",
        amount: "70000",
        method: "BANK",
        reference: purchase1.invoiceNumber,
        purchaseId: purchase1.id,
        notes: "GRN payment",
        businessDate: bizDate(8),
        createdById: owner.id,
      },
      {
        tenantId: tenant.id,
        branchId: dhk.id,
        partyType: "SUPPLIER",
        partyId: trims.id,
        direction: "OUT",
        amount: "2000",
        method: "CASH",
        notes: "Advance",
        businessDate: bizDate(6),
        createdById: manager.id,
      },
    ],
  });
  await prisma.customer.update({
    where: { id: ayesha.id },
    data: { creditDue: { decrement: 1500 } },
  });
  await prisma.customer.update({
    where: { id: corp.id },
    data: { creditDue: { decrement: 5000 } },
  });

  await prisma.loyaltyTransaction.createMany({
    data: [
      { tenantId: tenant.id, customerId: ayesha.id, type: "REDEEM", points: -50, notes: "Redeemed at POS" },
      { tenantId: tenant.id, customerId: ayesha.id, type: "ADJUST", points: 20, notes: "Goodwill birthday" },
      { tenantId: tenant.id, customerId: rafi.id, type: "REDEEM", points: -30, notes: "Tote discount" },
    ],
  });

  await prisma.dailyClosing.createMany({
    data: [
      {
        tenantId: tenant.id,
        branchId: dhk.id,
        businessDate: bizDate(1),
        openingCash: "5000",
        salesCash: "13450",
        expenseCash: "0",
        incomeCash: "80",
        paymentsIn: "1500",
        paymentsOut: "0",
        expectedCash: "20030",
        countedCash: "19980",
        variance: "-50",
        notes: "50 short — noted",
        closedById: manager.id,
      },
      {
        tenantId: tenant.id,
        branchId: utt.id,
        businessDate: bizDate(1),
        openingCash: "4000",
        salesCash: "7200",
        expenseCash: "0",
        incomeCash: "0",
        paymentsIn: "0",
        paymentsOut: "0",
        expectedCash: "11200",
        countedCash: "11200",
        variance: "0",
        closedById: c2.id,
      },
    ],
  });

  const soDelivered = await prisma.salesOrder.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      customerId: ayesha.id,
      status: "DELIVERED",
      number: `DHK-SO-${YEAR}-${pad(soN++)}`,
      notes: "Home delivery",
      subtotal: "1890",
      tax: "94.5",
      total: "1984.5",
      saleId: saleToday1.id,
      createdById: c1.id,
      items: {
        create: {
          variantId: k0.id,
          qty: "1",
          unitPrice: k0.price,
          lineTotal: "1984.5",
          nameSnapshot: k0.productName,
          skuSnapshot: k0.sku,
        },
      },
    },
  });
  const soPacked = await prisma.salesOrder.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      customerId: corp.id,
      status: "PACKED",
      number: `DHK-SO-${YEAR}-${pad(soN++)}`,
      notes: "Wholesale carton",
      subtotal: "4980",
      tax: "249",
      total: "5229",
      createdById: manager.id,
      items: {
        create: [
          { variantId: s0.id, qty: "2", unitPrice: s0.price, lineTotal: "5229", nameSnapshot: s0.productName, skuSnapshot: s0.sku },
        ],
      },
    },
  });
  await prisma.salesOrder.create({
    data: {
      tenantId: tenant.id,
      branchId: utt.id,
      customerId: farhan.id,
      status: "DRAFT",
      number: `UTT-SO-${YEAR}-${pad(1)}`,
      notes: "Call before packing",
      subtotal: "890",
      tax: "44.5",
      total: "934.5",
      createdById: c2.id,
      items: {
        create: {
          variantId: tote.id,
          qty: "1",
          unitPrice: tote.price,
          lineTotal: "934.5",
          nameSnapshot: tote.productName,
          skuSnapshot: tote.sku,
        },
      },
    },
  });
  await prisma.salesOrder.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      customerId: nabila.id,
      status: "CANCELLED",
      number: `DHK-SO-${YEAR}-${pad(soN++)}`,
      notes: "Customer cancelled",
      subtotal: "1290",
      total: "1354.5",
      createdById: c1.id,
    },
  });

  await prisma.delivery.createMany({
    data: [
      {
        tenantId: tenant.id,
        branchId: dhk.id,
        salesOrderId: soDelivered.id,
        saleId: saleToday1.id,
        status: "DELIVERED",
        courier: "Pathao",
        tracking: "PTH-10021",
        address: "Lalmatia, Dhaka",
        phone: ayesha.phone,
        scheduledAt: atHour(bizDate(0), 16),
        deliveredAt: atHour(bizDate(0), 17, 40),
      },
      {
        tenantId: tenant.id,
        branchId: dhk.id,
        salesOrderId: soPacked.id,
        status: "IN_TRANSIT",
        courier: "Sundarban",
        tracking: "SUN-8841",
        address: "Gulshan 2, Dhaka",
        phone: corp.phone,
        scheduledAt: atHour(bizDate(-1), 11),
      },
      {
        tenantId: tenant.id,
        branchId: utt.id,
        status: "PENDING",
        courier: "RedX",
        address: "Uttara Sector 7",
        phone: farhan.phone,
        notes: "Awaiting pack",
      },
      {
        tenantId: tenant.id,
        branchId: dhk.id,
        status: "FAILED",
        courier: "Pathao",
        tracking: "PTH-09912",
        address: "Wrong house, Dhanmondi",
        phone: rafi.phone,
        notes: "Recipient unreachable",
      },
    ],
  });

  await prisma.ecommerceOrder.createMany({
    data: [
      {
        tenantId: tenant.id,
        channel: "DARAZ",
        externalId: "DRZ-55001",
        customerId: farhan.id,
        status: "CONFIRMED",
        total: "934.50",
        payload: { sku: tote.sku, qty: 1, city: "Dhaka" },
      },
      {
        tenantId: tenant.id,
        channel: "WEBSITE",
        externalId: "WEB-22014",
        customerId: nabila.id,
        status: "SHIPPED",
        total: "1984.50",
        payload: { sku: k1.sku, qty: 1 },
      },
      {
        tenantId: tenant.id,
        channel: "FACEBOOK",
        externalId: "FB-inbox-88",
        customerId: rafi.id,
        status: "CANCELLED",
        total: "890",
        payload: { reason: "duplicate" },
      },
    ],
  });

  await prisma.notificationLog.createMany({
    data: [
      {
        tenantId: tenant.id,
        channel: "WHATSAPP",
        to: ayesha.phone,
        template: "INVOICE",
        type: "SALE_COMPLETED",
        title: "Invoice sent",
        message: `WhatsApp invoice ${saleToday1.invoiceNumber}`,
        status: "QUEUED",
        error: "provider_not_configured",
        isRead: true,
        payload: { invoice: saleToday1.invoiceNumber },
        recipientUserId: owner.id,
        recipientRole: "TENANT_OWNER",
      },
      {
        tenantId: tenant.id,
        channel: "EMAIL",
        to: corp.email ?? "accounts@studionoon.example",
        template: "STATEMENT",
        type: "DUE_PAYMENT",
        title: "Statement",
        message: "Customer statement due 12500",
        status: "QUEUED",
        error: "provider_not_configured",
        isRead: true,
        payload: { due: "12500" },
        recipientUserId: owner.id,
        recipientRole: "TENANT_OWNER",
      },
      {
        tenantId: tenant.id,
        channel: "SMS",
        to: farhan.phone,
        template: "OTP",
        type: "SYSTEM_ALERT",
        title: "OTP",
        message: "Gateway timeout",
        status: "FAILED",
        payload: {},
        error: "Gateway timeout",
        isRead: true,
        recipientRole: "OUTLET_MANAGER",
      },
      {
        tenantId: tenant.id,
        channel: "IN_APP",
        to: manager.id,
        template: "LOW_STOCK",
        type: "LOW_STOCK",
        title: `Low stock: ${playTee.sku}`,
        message: `${playTee.sku} has 3 available. Threshold 5.`,
        status: "SENT",
        payload: { sku: playTee.sku, qty: "3" },
        recipientUserId: manager.id,
        recipientRole: "OUTLET_MANAGER",
        actionUrl: `/inventory?q=${playTee.sku}`,
        priority: "HIGH",
      },
      {
        tenantId: tenant.id,
        channel: "IN_APP",
        to: owner.id,
        template: "LOW_STOCK",
        type: "LOW_STOCK",
        title: `Low stock: ${scarf.sku}`,
        message: `${scarf.sku} has 4 available. Threshold 5.`,
        status: "SENT",
        payload: { sku: scarf.sku, qty: "4" },
        recipientUserId: owner.id,
        recipientRole: "TENANT_OWNER",
        actionUrl: `/inventory?q=${scarf.sku}`,
      },
    ],
  });

  const keyRaw = "pos_seed_demo_key_not_for_production";
  await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      name: "Daraz sync",
      keyPrefix: keyRaw.slice(0, 12),
      keyHash: createHash("sha256").update(keyRaw).digest("hex"),
      lastUsedAt: bizDate(1),
    },
  });
  await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      name: "Old website (revoked)",
      keyPrefix: "pos_revoked_",
      keyHash: createHash("sha256").update("revoked").digest("hex"),
      revokedAt: bizDate(12),
    },
  });

  await prisma.backupRecord.createMany({
    data: [
      { tenantId: tenant.id, status: "COMPLETE", note: "Nightly", payloadSize: 248120, createdById: owner.id, createdAt: atHour(bizDate(1), 2) },
      { tenantId: tenant.id, status: "FAILED", note: "Disk full", payloadSize: 0, createdById: owner.id, createdAt: atHour(bizDate(4), 2) },
      { tenantId: tenant.id, status: "PENDING", note: "Manual", payloadSize: 0, createdById: manager.id },
    ],
  });

  await prisma.packMigration.create({
    data: {
      tenantId: tenant.id,
      pack: "FASHION",
      fromVersion: "0.9.0",
      toVersion: "1.0.0",
      checksum: "fashion-1.0.0-seed",
    },
  });

  await prisma.auditLog.createMany({
    data: [
      { tenantId: tenant.id, userId: owner.id, actorUserId: owner.id, action: "AUTH_LOGIN", entityType: "User", entityId: owner.id, ip: "127.0.0.1", userAgent: "seed" },
      { tenantId: tenant.id, userId: owner.id, actorUserId: owner.id, action: "CATALOG_CREATE", entityType: "Product", entityId: kurta.id, after: { code: "KURTA-01" } },
      { tenantId: tenant.id, userId: c1.id, actorUserId: c1.id, action: "SALE_CREATE", entityType: "Sale", entityId: saleToday1.id, after: { invoice: saleToday1.invoiceNumber } },
      { tenantId: tenant.id, userId: manager.id, actorUserId: manager.id, action: "RETURN_APPROVE", entityType: "SaleReturn", entityId: retPartial.id },
      { tenantId: tenant.id, userId: owner.id, actorUserId: owner.id, action: "PURCHASE_RECEIVE", entityType: "Purchase", entityId: purchase1.id },
      { tenantId: tenant.id, userId: manager.id, actorUserId: manager.id, action: "SHIFT_CLOSE", entityType: "Shift", entityId: shiftDhkY.id },
      { tenantId: tenant.id, userId: owner.id, actorUserId: owner.id, action: "SETTINGS_UPDATE", entityType: "TenantSettings", entityId: tenant.id },
    ],
  });
  await prisma.loginAttempt.createMany({
    data: [
      { email: "owner@nokshi.local", success: true, ip: "127.0.0.1" },
      { email: "owner@nokshi.local", success: false, ip: "10.0.0.8" },
      { email: "cashier.dhk@nokshi.local", success: true, ip: "127.0.0.1" },
    ],
  });

  await prisma.documentNumberSequence.updateMany({
    where: { tenantId: tenant.id, branchId: dhk.id, documentType: "INVOICE", fiscalYear: YEAR },
    data: { nextNumber: dhkInv },
  });
  await prisma.documentNumberSequence.updateMany({
    where: { tenantId: tenant.id, branchId: utt.id, documentType: "INVOICE", fiscalYear: YEAR },
    data: { nextNumber: uttInv },
  });
  await prisma.documentNumberSequence.updateMany({
    where: { tenantId: tenant.id, branchId: dhk.id, documentType: "RETURN", fiscalYear: YEAR },
    data: { nextNumber: dhkRet },
  });
  await prisma.documentNumberSequence.updateMany({
    where: { tenantId: tenant.id, branchId: utt.id, documentType: "RETURN", fiscalYear: YEAR },
    data: { nextNumber: 2 },
  });
  await prisma.documentNumberSequence.updateMany({
    where: { tenantId: tenant.id, documentType: "PO", fiscalYear: YEAR },
    data: { nextNumber: poN + 2 },
  });
  await prisma.documentNumberSequence.updateMany({
    where: { tenantId: tenant.id, documentType: "PURCHASE", fiscalYear: YEAR },
    data: { nextNumber: grnN + 1 },
  });
  await prisma.documentNumberSequence.updateMany({
    where: { tenantId: tenant.id, documentType: "SALES_ORDER", fiscalYear: YEAR },
    data: { nextNumber: soN + 1 },
  });

  const other = await prisma.tenant.create({
    data: { name: "Other Retail", industryPack: "FASHION", country: "BD" },
  });
  await prisma.tenantSettings.create({
    data: { tenantId: other.id, currency: "BDT", invoiceFooter: "Other Retail" },
  });
  const otherLoc = await prisma.location.create({
    data: { tenantId: other.id, type: "STORE", name: "Other Floor" },
  });
  const otherBranch = await prisma.branch.create({
    data: { tenantId: other.id, locationId: otherLoc.id, name: "Other Outlet", code: "OTH" },
  });
  const otherUser = await prisma.user.create({
    data: {
      email: "cashier@other.local",
      name: "Other Cashier",
      passwordHash: await hash("Cashier123!"),
    },
  });
  await prisma.userTenant.create({ data: { userId: otherUser.id, tenantId: other.id } });
  const otherRole = await prisma.role.create({
    data: { tenantId: other.id, key: "CASHIER", name: "Cashier" },
  });
  await prisma.rolePermission.createMany({
    data: CASHIER_KEYS.map((k) => ({ roleId: otherRole.id, permissionId: perm(k) })),
  });
  await prisma.userRole.create({ data: { userId: otherUser.id, roleId: otherRole.id } });
  await prisma.userBranch.create({ data: { userId: otherUser.id, branchId: otherBranch.id } });

  console.log("Seeded Nokshi Fashion pack v1 (full demo dataset)");
  console.log("platform@pos.local / Admin123!");
  console.log("owner@nokshi.local / Owner123!");
  console.log("manager@nokshi.local / Manager123!");
  console.log("cashier.dhk@nokshi.local / Cashier123!");
  console.log("cashier.utt@nokshi.local / Cashier123!");
  console.log("cashier.dhk2@nokshi.local / Cashier123!");
  console.log("cashier@other.local / Cashier123!");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
