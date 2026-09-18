import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

process.env.WEB_ORIGIN =
  "http://localhost:3020,https://shohojhisab.com,https://mobile.shohojhisab.com";

const prisma = new PrismaClient();

const CASHIER_KEYS = [
  "sale.create", "sale.view", "sale.return", "discount.apply",
  "shift.open", "shift.close", "customer.view", "inventory.view",
  "notification.view", "sms.send",
];

const MANAGER_KEYS = [
  "sale.create", "sale.view", "sale.void", "sale.return", "sale.return.approve",
  "price.override", "discount.apply", "discount.approve", "refund.approve",
  "shift.open", "shift.close", "shift.manage", "report.view", "report.finance",
  "catalog.manage", "inventory.view", "inventory.adjust", "inventory.transfer",
  "inventory.reserve", "inventory.receive.view", "inventory.receive.create",
  "inventory.receive.approve", "inventory.damage.view", "inventory.damage.create",
  "inventory.damage.approve", "inventory.ledger.view", "purchase.view",
  "purchase.manage", "expense.view", "expense.manage", "income.view",
  "income.manage", "payment.view", "payment.manage", "finance.view",
  "customer.view", "customer.manage", "supplier.view", "supplier.manage",
  "loyalty.manage", "attendance.manage", "audit.view", "settings.manage",
  "tenant.manage", "branch.manage", "warehouse.manage",
  "tenant.access_request.create", "tenant.access_request.cancel",
  "notification.send", "import.manage", "barcode.manage",
  "order.view", "order.manage", "delivery.manage",
  "sms.view", "sms.send", "sms.settings", "user.create",
];

const ALL_PERMS = [...new Set([...CASHIER_KEYS, ...MANAGER_KEYS])];

async function ensureRole(key: string, name: string, permKeys: string[], permMap: Map<string, string>) {
  let role = await prisma.role.findFirst({ where: { key, tenantId: null } });
  if (!role) role = await prisma.role.create({ data: { tenantId: null, key, name } });
  const data = permKeys.filter((k) => permMap.has(k)).map((k) => ({ roleId: role!.id, permissionId: permMap.get(k)! }));
  if (data.length) await prisma.rolePermission.createMany({ data, skipDuplicates: true });
  return role!;
}

async function ensureUser(email: string, name: string, pass: string) {
  const hash = await bcrypt.hash(pass, 10);
  let user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    user = await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hash } });
  } else {
    user = await prisma.user.create({ data: { email, name, passwordHash: hash } });
  }
  return user;
}

async function ensureUserRole(userId: string, roleId: string) {
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId, roleId } },
    create: { userId, roleId },
    update: {},
  });
}

async function ensureUserTenant(userId: string, tenantId: string, allBranches = false, isPlatform = false) {
  await prisma.userTenant.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    create: { userId, tenantId, allBranches, isPlatform },
    update: { allBranches, isPlatform },
  });
}

async function ensureUserBranch(userId: string, branchId: string) {
  await prisma.userBranch.upsert({
    where: { userId_branchId: { userId, branchId } },
    create: { userId, branchId },
    update: {},
  });
}

async function main() {
  const permissions = await Promise.all(ALL_PERMS.map((key) =>
    prisma.permission.upsert({ where: { key }, create: { key }, update: {} })
  ));
  const permMap = new Map(permissions.map((p) => [p.key, p.id]));

  const platformRole = await ensureRole("PLATFORM_SUPER_ADMIN", "Platform super admin", ALL_PERMS, permMap);
  const ownerRole = await ensureRole("TENANT_OWNER", "Tenant owner", ALL_PERMS, permMap);
  const managerRole = await ensureRole("OUTLET_MANAGER", "Outlet manager", MANAGER_KEYS, permMap);
  const cashierRole = await ensureRole("CASHIER", "Cashier", CASHIER_KEYS, permMap);

  const platform = await ensureUser("platform@pos.local", "Platform Admin", "Admin123!");
  await ensureUserRole(platform.id, platformRole.id);

  const tenant = await prisma.tenant.upsert({
    where: { id: "test-nokshi-tenant" },
    create: { id: "test-nokshi-tenant", name: "Nokshi Fashion", industryPack: "FASHION", country: "BD" },
    update: {},
  });

  await ensureUserTenant(platform.id, tenant.id, true, true);

  const owner = await ensureUser("owner@nokshi.local", "Nokshi Owner", "Owner123!");
  await ensureUserTenant(owner.id, tenant.id, true);
  await ensureUserRole(owner.id, ownerRole.id);

  const manager = await ensureUser("manager@nokshi.local", "Nokshi Manager", "Manager123!");
  await ensureUserTenant(manager.id, tenant.id, true);
  await ensureUserRole(manager.id, managerRole.id);

  const dhkLoc = await prisma.location.upsert({
    where: { id: "test-dhk-loc" },
    create: { id: "test-dhk-loc", tenantId: tenant.id, type: "STORE", name: "Dhanmondi" },
    update: {},
  });
  const uttLoc = await prisma.location.upsert({
    where: { id: "test-utt-loc" },
    create: { id: "test-utt-loc", tenantId: tenant.id, type: "STORE", name: "Uttara" },
    update: {},
  });

  const dhkBranch = await prisma.branch.upsert({
    where: { id: "test-dhk-branch" },
    create: { id: "test-dhk-branch", tenantId: tenant.id, locationId: dhkLoc.id, name: "Dhanmondi", code: "DHK" },
    update: {},
  });
  const uttBranch = await prisma.branch.upsert({
    where: { id: "test-utt-branch" },
    create: { id: "test-utt-branch", tenantId: tenant.id, locationId: uttLoc.id, name: "Uttara", code: "UTT" },
    update: {},
  });

  const dhkRegister = await prisma.register.upsert({
    where: { id: "test-dhk-register" },
    create: { id: "test-dhk-register", tenantId: tenant.id, branchId: dhkBranch.id, name: "DHK-REG-01" },
    update: {},
  });
  const uttRegister = await prisma.register.upsert({
    where: { id: "test-utt-register" },
    create: { id: "test-utt-register", tenantId: tenant.id, branchId: uttBranch.id, name: "UTT-REG-01" },
    update: {},
  });

  await prisma.tillDevice.upsert({
    where: { registerId_hardwareId: { registerId: dhkRegister.id, hardwareId: "DHK-TILL-01" } },
    create: { registerId: dhkRegister.id, hardwareId: "DHK-TILL-01", name: "DHK TILL 01" },
    update: {},
  });
  await prisma.tillDevice.upsert({
    where: { registerId_hardwareId: { registerId: uttRegister.id, hardwareId: "UTT-TILL-01" } },
    create: { registerId: uttRegister.id, hardwareId: "UTT-TILL-01", name: "UTT TILL 01" },
    update: {},
  });

  const cashierDhk = await ensureUser("cashier.dhk@nokshi.local", "DHK Cashier", "Cashier123!");
  await ensureUserTenant(cashierDhk.id, tenant.id, false);
  await ensureUserRole(cashierDhk.id, cashierRole.id);
  await ensureUserBranch(cashierDhk.id, dhkBranch.id);

  const cashierUtt = await ensureUser("cashier.utt@nokshi.local", "UTT Cashier", "Cashier123!");
  await ensureUserTenant(cashierUtt.id, tenant.id, false);
  await ensureUserRole(cashierUtt.id, cashierRole.id);
  await ensureUserBranch(cashierUtt.id, uttBranch.id);

  const cashierDhk2 = await ensureUser("cashier.dhk2@nokshi.local", "DHK Cashier 2", "Cashier123!");
  await ensureUserTenant(cashierDhk2.id, tenant.id, false);
  await ensureUserRole(cashierDhk2.id, cashierRole.id);
  await ensureUserBranch(cashierDhk2.id, dhkBranch.id);

  const taxCat = await prisma.taxCategory.upsert({
    where: { id: "test-tax-default" },
    create: { id: "test-tax-default", tenantId: tenant.id, name: "Default", rate: 0 },
    update: {},
  });

  const brand = await prisma.brand.upsert({
    where: { id: "test-brand-nokshi" },
    create: { id: "test-brand-nokshi", tenantId: tenant.id, name: "Nokshi" },
    update: {},
  });

  const unit = await prisma.unit.upsert({
    where: { id: "test-unit-pc" },
    create: { id: "test-unit-pc", tenantId: tenant.id, name: "Piece", abbreviation: "pc" },
    update: {},
  });

  const category = await prisma.category.upsert({
    where: { id: "test-cat-ethnic" },
    create: { id: "test-cat-ethnic", tenantId: tenant.id, name: "Ethnic Wear", slug: "ethnic-wear" },
    update: {},
  });

  const subcategory = await prisma.subcategory.upsert({
    where: { id: "test-sub-kurta" },
    create: { id: "test-sub-kurta", tenantId: tenant.id, categoryId: category.id, name: "Kurta", slug: "kurta" },
    update: {},
  });

  const colorDef = await prisma.attributeDefinition.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "Color" } },
    create: { tenantId: tenant.id, key: "Color", name: "Color", dataType: "TEXT" },
    update: {},
  });
  const sizeDef = await prisma.attributeDefinition.upsert({
    where: { tenantId_key: { tenantId: tenant.id, key: "Size" } },
    create: { tenantId: tenant.id, key: "Size", name: "Size", dataType: "TEXT" },
    update: {},
  });

  const colorRed = await prisma.attributeOption.upsert({
    where: { definitionId_value: { definitionId: colorDef.id, value: "Red" } },
    create: { definitionId: colorDef.id, value: "Red", label: "Red" },
    update: {},
  });
  const colorBlue = await prisma.attributeOption.upsert({
    where: { definitionId_value: { definitionId: colorDef.id, value: "Blue" } },
    create: { definitionId: colorDef.id, value: "Blue", label: "Blue" },
    update: {},
  });
  const sizeM = await prisma.attributeOption.upsert({
    where: { definitionId_value: { definitionId: sizeDef.id, value: "M" } },
    create: { definitionId: sizeDef.id, value: "M", label: "M" },
    update: {},
  });
  const sizeL = await prisma.attributeOption.upsert({
    where: { definitionId_value: { definitionId: sizeDef.id, value: "L" } },
    create: { definitionId: sizeDef.id, value: "L", label: "L" },
    update: {},
  });

  await prisma.product.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "KURTA-001" } },
    create: {
      id: "test-prod-kurta", tenantId: tenant.id, name: "Cotton Kurta", code: "KURTA-001",
      type: "VARIABLE", taxCategoryId: taxCat.id, brandId: brand.id, unitId: unit.id,
      subcategoryId: subcategory.id, categoryId: category.id, category: "Ethnic Wear",
      sellingPrice: 1500, purchasePrice: 800, posSaleEnabled: true, trackInventory: true,
    },
    update: { sellingPrice: 1500, purchasePrice: 800 },
  });

  const variants = [
    { id: "test-var-kurta-red-m", sku: "KURTA-001-RED-M", vk: "color:red|size:m", opts: [colorRed.id, sizeM.id] },
    { id: "test-var-kurta-blue-l", sku: "KURTA-001-BLUE-L", vk: "color:blue|size:l", opts: [colorBlue.id, sizeL.id] },
    { id: "test-var-kurta-red-l", sku: "KURTA-001-RED-L", vk: "color:red|size:l", opts: [colorRed.id, sizeL.id] },
    { id: "test-var-kurta-blue-m", sku: "KURTA-001-BLUE-M", vk: "color:blue|size:m", opts: [colorBlue.id, sizeM.id] },
  ];

  for (const v of variants) {
    await prisma.productVariant.upsert({
      where: { id: v.id },
      create: { id: v.id, tenantId: tenant.id, productId: "test-prod-kurta", sku: v.sku, variantKey: v.vk, price: 1500, cost: 800 },
      update: { price: 1500, cost: 800 },
    });
    for (const optId of v.opts) {
      await prisma.variantAttributeValue.upsert({
        where: { variantId_optionId: { variantId: v.id, optionId: optId } },
        create: { variantId: v.id, optionId: optId },
        update: {},
      });
    }
  }

  for (const locId of [dhkLoc.id, uttLoc.id]) {
    for (const v of variants) {
      await prisma.stock.upsert({
        where: { tenantId_locationId_channel_variantId: { tenantId: tenant.id, locationId: locId, channel: "STORE", variantId: v.id } },
        create: { tenantId: tenant.id, locationId: locId, channel: "STORE", variantId: v.id, quantity: 20 },
        update: { quantity: 20 },
      });
    }
  }

  for (const v of variants) {
    await prisma.barcode.upsert({
      where: { id: `test-bc-${v.sku}` },
      create: { id: `test-bc-${v.sku}`, tenantId: tenant.id, variantId: v.id, code: `${v.sku}-BC`, active: true, primary: true },
      update: {},
    });
  }

  const product2 = await prisma.product.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: "SHIRT-001" } },
    create: {
      id: "test-prod-shirt", tenantId: tenant.id, name: "Oxford Shirt", code: "SHIRT-001",
      type: "SIMPLE", taxCategoryId: taxCat.id, brandId: brand.id, unitId: unit.id,
      category: "Casual Wear", sellingPrice: 1200, purchasePrice: 600, posSaleEnabled: true, trackInventory: true,
    },
    update: { sellingPrice: 1200, purchasePrice: 600 },
  });

  const shirtVariant = await prisma.productVariant.findFirst({ where: { productId: product2.id } });
  if (shirtVariant) {
    for (const locId of [dhkLoc.id, uttLoc.id]) {
      await prisma.stock.upsert({
        where: { tenantId_locationId_channel_variantId: { tenantId: tenant.id, locationId: locId, channel: "STORE", variantId: shirtVariant.id } },
        create: { tenantId: tenant.id, locationId: locId, channel: "STORE", variantId: shirtVariant.id, quantity: 20 },
        update: { quantity: 20 },
      });
    }
  }

  await prisma.supplier.upsert({
    where: { id: "test-supplier-1" },
    create: { id: "test-supplier-1", tenantId: tenant.id, name: "Fashion Hub Ltd", phone: "+8801712345678" },
    update: {},
  });

  await prisma.documentNumberSequence.upsert({
    where: { tenantId_branchId_documentType_fiscalYear: { tenantId: tenant.id, branchId: dhkBranch.id, documentType: "SALE", fiscalYear: new Date().getFullYear() } },
    create: { tenantId: tenant.id, branchId: dhkBranch.id, documentType: "SALE", fiscalYear: new Date().getFullYear(), prefix: "INV", nextNumber: 1, padding: 6 },
    update: {},
  });
  await prisma.documentNumberSequence.upsert({
    where: { tenantId_branchId_documentType_fiscalYear: { tenantId: tenant.id, branchId: uttBranch.id, documentType: "SALE", fiscalYear: new Date().getFullYear() } },
    create: { tenantId: tenant.id, branchId: uttBranch.id, documentType: "SALE", fiscalYear: new Date().getFullYear(), prefix: "INV", nextNumber: 1, padding: 6 },
    update: {},
  });

  console.log("Test data seeded successfully");
}

main().catch((e) => {
  console.error("Test setup failed:", e);
});
