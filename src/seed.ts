import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { buildVariantKey } from "./shared/variant-key";
import { CASHIER_KEYS, MANAGER_KEYS, Permissions } from "./shared/permissions";

const prisma = new PrismaClient();

async function main() {
  await prisma.loginAttempt.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.accountingEvent.deleteMany();
  await prisma.fiscalDocument.deleteMany();
  await prisma.outboxEvent.deleteMany();
  await prisma.idempotencyRecord.deleteMany();
  await prisma.saleDocument.deleteMany();
  await prisma.paymentTransaction.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.heldSale.deleteMany();
  await prisma.loyaltyTransaction.deleteMany();
  await prisma.ledgerPayment.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.purchaseOrderItem.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.salesOrderItem.deleteMany();
  await prisma.delivery.deleteMany();
  await prisma.salesOrder.deleteMany();
  await prisma.ecommerceOrder.deleteMany();
  await prisma.notificationLog.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.expenseCategory.deleteMany();
  await prisma.income.deleteMany();
  await prisma.dailyClosing.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.shiftTemplate.deleteMany();
  await prisma.invoiceTemplate.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.backupRecord.deleteMany();
  await prisma.tenantSettings.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.barcode.deleteMany();
  await prisma.variantAttributeValue.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
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

  await prisma.currency.create({ data: { code: "BDT", name: "Bangladeshi Taka" } });
  await prisma.currency.create({ data: { code: "USD", name: "US Dollar" } });

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
  await prisma.plan.create({
    data: {
      code: "STARTER",
      name: "Starter",
      interval: "MONTHLY",
      price: "1499",
      features: ["POS", "INVENTORY"],
      limits: { maxBranches: 1, maxUsers: 3, maxProducts: 500, maxWarehouses: 1 },
    },
  });
  await prisma.plan.create({
    data: {
      code: "UNIVERSAL",
      name: "Universal",
      interval: "MONTHLY",
      price: "12999",
      features: ["ALL"],
      limits: { maxBranches: 99, maxUsers: 500, maxProducts: 100000, maxWarehouses: 50 },
    },
  });

  const tenant = await prisma.tenant.create({
    data: {
      name: "Nokshi Lifestyle",
      industryPack: "FASHION",
      industryPackVersion: "1.0.0",
      country: "BD",
      subscriptionStatus: "TRIAL",
      planId: growth.id,
    },
  });

  await prisma.tenantSettings.create({
    data: {
      tenantId: tenant.id,
      currency: "BDT",
      invoiceFooter: "Thank you for shopping at Nokshi Lifestyle",
      whatsappEnabled: true,
      emailEnabled: true,
    },
  });
  await prisma.invoiceTemplate.create({
    data: {
      tenantId: tenant.id,
      name: "Standard",
      kind: "INVOICE",
      body: "{{business}} {{invoiceNumber}} {{total}}",
      isDefault: true,
    },
  });

  await prisma.business.create({
    data: {
      tenantId: tenant.id,
      name: "Nokshi Lifestyle",
      legalName: "Nokshi Lifestyle Ltd.",
      vatId: "BIN-000123456",
      address: "Dhanmondi, Dhaka",
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
  await prisma.stockLocationChannel.createMany({
    data: [
      { tenantId: tenant.id, locationId: locDhk.id, channel: "STORE" },
      { tenantId: tenant.id, locationId: locUtt.id, channel: "STORE" },
      { tenantId: tenant.id, locationId: locWh.id, channel: "WAREHOUSE" },
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

  const year = new Date().getFullYear();
  for (const b of [dhk, utt]) {
    await prisma.documentNumberSequence.create({
      data: {
        tenantId: tenant.id,
        branchId: b.id,
        documentType: "INVOICE",
        fiscalYear: year,
        prefix: `${b.code}-INV-${year}-`,
      },
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
    data: {
      email: "platform@pos.local",
      name: "Platform Admin",
      passwordHash: await hash("Admin123!"),
    },
  });
  const owner = await prisma.user.create({
    data: {
      email: "owner@nokshi.local",
      name: "Nokshi Owner",
      passwordHash: await hash("Owner123!"),
    },
  });
  const manager = await prisma.user.create({
    data: {
      email: "manager@nokshi.local",
      name: "Outlet Manager",
      passwordHash: await hash("Manager123!"),
    },
  });
  const c1 = await prisma.user.create({
    data: {
      email: "cashier.dhk@nokshi.local",
      name: "Dhanmondi Cashier",
      passwordHash: await hash("Cashier123!"),
    },
  });
  const c2 = await prisma.user.create({
    data: {
      email: "cashier.utt@nokshi.local",
      name: "Uttara Cashier",
      passwordHash: await hash("Cashier123!"),
    },
  });

  await prisma.userTenant.createMany({
    data: [
      { userId: platform.id, tenantId: tenant.id, isPlatform: true, allBranches: true },
      { userId: owner.id, tenantId: tenant.id, allBranches: true },
      { userId: manager.id, tenantId: tenant.id, allBranches: true },
      { userId: c1.id, tenantId: tenant.id },
      { userId: c2.id, tenantId: tenant.id },
    ],
  });
  await prisma.userRole.createMany({
    data: [
      { userId: platform.id, roleId: platRole.id },
      { userId: owner.id, roleId: ownerRole.id },
      { userId: manager.id, roleId: mgrRole.id },
      { userId: c1.id, roleId: cashRole.id },
      { userId: c2.id, roleId: cashRole.id },
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
    ],
  });

  const regDhk = await prisma.register.create({
    data: { tenantId: tenant.id, branchId: dhk.id, name: "Register 01" },
  });
  const regUtt = await prisma.register.create({
    data: { tenantId: tenant.id, branchId: utt.id, name: "Register 01" },
  });
  await prisma.tillDevice.create({
    data: { registerId: regDhk.id, hardwareId: "DHK-TILL-01", name: "Dhanmondi Till 1" },
  });
  await prisma.tillDevice.create({
    data: { registerId: regUtt.id, hardwareId: "UTT-TILL-01", name: "Uttara Till 1" },
  });

  const vat = await prisma.taxCategory.create({
    data: { tenantId: tenant.id, name: "VAT 5%", rate: "5" },
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
    ].map(([value, label], i) =>
      prisma.attributeOption.create({
        data: { definitionId: size.id, value, label, sortOrder: i },
      }),
    ),
  );
  await prisma.attributeOption.create({
    data: { definitionId: fit.id, value: "regular", label: "Regular" },
  });

  const kurta = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      name: "Cotton Kurta",
      code: "KURTA-01",
      category: "Women",
      taxCategoryId: vat.id,
    },
  });
  const shirt = await prisma.product.create({
    data: {
      tenantId: tenant.id,
      name: "Oxford Shirt",
      code: "SHIRT-01",
      category: "Men",
      taxCategoryId: vat.id,
    },
  });

  let skuN = 1;
  for (const product of [kurta, shirt]) {
    const base = product.id === kurta.id ? 1890 : 2490;
    for (const c of colours) {
      for (const s of sizes) {
        const variantKey = buildVariantKey([
          { key: "colour", value: c.value },
          { key: "size", value: s.value },
        ]);
        const sku = `${product.code}-${c.value}-${s.value}`.toUpperCase();
        const v = await prisma.productVariant.create({
          data: {
            tenantId: tenant.id,
            productId: product.id,
            sku,
            variantKey,
            price: String(base),
            cost: String(Math.round(base * 0.45)),
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
          data: {
            tenantId: tenant.id,
            variantId: v.id,
            code,
            kind: "EAN13",
            primary: true,
          },
        });
        for (const loc of [locDhk, locUtt]) {
          await prisma.stock.create({
            data: {
              tenantId: tenant.id,
              locationId: loc.id,
              variantId: v.id,
              quantity: loc.id === locDhk.id ? "12" : "8",
            },
          });
        }
      }
    }
  }

  const other = await prisma.tenant.create({
    data: { name: "Other Retail", industryPack: "FASHION", country: "BD" },
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
    data: CASHIER_KEYS.map((k) => ({
      roleId: otherRole.id,
      permissionId: perm(k),
    })),
  });
  await prisma.userRole.create({ data: { userId: otherUser.id, roleId: otherRole.id } });
  await prisma.userBranch.create({ data: { userId: otherUser.id, branchId: otherBranch.id } });

  const rent = await prisma.expenseCategory.create({ data: { tenantId: tenant.id, name: "Rent" } });
  await prisma.expenseCategory.create({ data: { tenantId: tenant.id, name: "Utilities" } });
  await prisma.expenseCategory.create({ data: { tenantId: tenant.id, name: "Salaries" } });
  await prisma.expenseCategory.create({ data: { tenantId: tenant.id, name: "Marketing" } });
  await prisma.expense.create({
    data: {
      tenantId: tenant.id,
      branchId: dhk.id,
      categoryId: rent.id,
      amount: "45000",
      method: "BANK",
      vendor: "Landlord",
      notes: "Shop rent",
      businessDate: new Date(),
      createdById: owner.id,
    },
  });
  await prisma.supplier.create({
    data: {
      tenantId: tenant.id,
      name: "Dhaka Textile Mills",
      phone: "+8801800000001",
      email: "sales@dtm.example",
      address: "Tejgaon, Dhaka",
    },
  });
  await prisma.shiftTemplate.create({
    data: {
      tenantId: tenant.id,
      name: "Morning",
      startTime: "09:00",
      endTime: "17:00",
      days: ["SAT", "SUN", "MON", "TUE", "WED", "THU"],
    },
  });
  await prisma.customer.create({
    data: {
      tenantId: tenant.id,
      name: "Ayesha Rahman",
      phone: "+8801711000001",
      phoneCanonical: "+8801711000001",
      email: "ayesha@example.com",
      loyaltyPoints: 120,
      creditLimit: "20000",
    },
  });

  console.log("Seeded Nokshi Fashion pack v1");
  console.log("platform@pos.local / Admin123!");
  console.log("owner@nokshi.local / Owner123!");
  console.log("cashier.dhk@nokshi.local / Cashier123!");
  console.log("cashier@other.local / Cashier123!");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
