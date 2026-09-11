# Prisma schema (split by domain)

Prisma loads **every** `.prisma` file in this folder. Relations work across files.

| File | What lives here |
|---|---|
| `schema.prisma` | Generator + PostgreSQL connection |
| `enums.prisma` | All enums |
| `tenant.prisma` | Tenant, Business, Currency |
| `location.prisma` | Location, Branch, Register, Till |
| `identity.prisma` | User, Role, Session |
| `catalog.prisma` | Product, Variant, Attributes, Barcode, Tax |
| `inventory.prisma` | Stock, StockMovement |
| `customer.prisma` | Customer |
| `sales.prisma` | Sale, Payment, Invoice documents |
| `shift.prisma` | Cashier shift |
| `platform.prisma` | Outbox, Audit, Idempotency, Packs |
| `sms.prisma` | Tenant SMS settings, templates, logs, usage |

Do not put models back into one giant file.
