# Codebase Map

## Backend (`backend/src/`)

### Core Files
| Path | Purpose |
|------|---------|
| `app.ts` | Express app factory |
| `app/routes.ts` | Registers all module routers |
| `index.ts` | Bootstrap entry point |
| `types.ts` | `RequestContext`, `AuthedRequest` |
| `middleware/auth.ts` | Auth middleware: `requireAuth`, `requireTenant`, `requirePermission`, `requirePlatformSuperAdmin` |
| `middleware/validate.ts` | Zod validation: `validateBody`, `validateQuery`, `validateParams` |
| `middleware/error.middleware.ts` | Centralized error handling |
| `middleware/csrf.ts` | CSRF protection |
| `middleware/plan-enforcement.ts` | Plan limit/feature enforcement |
| `lib/scope.ts` | Tenant/branch scoping utilities |
| `lib/list-query.ts` | Pagination, sorting, query parsing |
| `lib/erp.ts` | Tenant/branch helpers, document numbering |
| `lib/audit.ts` | Audit logging |
| `lib/envelope.ts` | Response helpers: `ok`, `okList`, `fail` |
| `lib/prisma.ts` | PrismaClient singleton |
| `lib/http-errors.ts` | HTTP errors, idempotency key lifecycle |
| `utils/errors.ts` | `AppError` class hierarchy and error codes |
| `utils/response.ts` | Re-exports envelope helpers |
| `shared/permissions.ts` | `Permissions`, `MANAGER_KEYS`, `CASHIER_KEYS` |
| `shared/money.ts` | Decimal-based monetary calculations |

### Modules

#### Auth (`modules/auth/`)
- Route: `/api/v1/auth`
- Purpose: Login, logout, current user context, profile management, change password
- Key: `requireAuth` handles JWT validation; `PLATFORM_SUPER_ADMIN` special handling
- Profile endpoints: `GET /profile`, `PATCH /profile`, `POST /profile/image`, `POST /change-password`
- Files: `index.ts`, `auth.routes.ts`, `auth.controller.ts`, `auth.service.ts`, `auth.repository.ts`, `auth.types.ts`, `auth.validation.ts`

#### Staff (`modules/staff/`)
- Route: `/api/v1/staff`
- Purpose: Roles (platform-only), attendance, shift templates, sessions, login attempts
- Key: Roles managed by `PLATFORM_SUPER_ADMIN` only; attendance is tenant-scoped
- Files: `staff.routes.ts`, `staff.controller.ts`, `staff.service.ts`, `staff.repository.ts`, `staff.types.ts`, `staff.validation.ts`

#### Users (`modules/users/`)
- Route: `/api/v1/users`
- Purpose: User CRUD, role assignment, tenant membership, deactivation
- Key: `TENANT_OWNER` auto-bootstrapped; outbox events for user changes
- Files: `users.routes.ts`, `users.controller.ts`, `users.service.ts`, `users.repository.ts`

#### Catalog (`modules/catalog/`)
- Route: `/api/v1/catalog`
- Purpose: Products, variants, categories, subcategories, brands, units, attributes, tax, barcodes
- Key: `productInclude`/`productListInclude` for rich Prisma includes; variant generation engine
- Files: `catalog.products.controller.ts`, `catalog.products.service.ts`, `catalog.taxonomy.controller.ts`, `catalog.taxonomy.service.ts`, `catalog.repository.ts`

#### Inventory (`modules/inventory/`)
- Route: `/api/v1/inventory`
- Purpose: Stock, movements, receipts, damage, stock takes, reservations
- Key: Stock buckets (AVAILABLE, DAMAGED, QUARANTINE); immutable stock movements
- Key files: `stock.engine.ts` (core arithmetic), `stock.repository.ts`, `ledger.service.ts`, `receipts.service.ts`, `damage.service.ts`

#### Sales (`modules/sales/`)
- Route: `/api/v1/sales`
- Purpose: POS transactions, returns, voids, holds, payments
- Key: Open shift required; invoice number via `DocumentNumberSequence`; idempotency; fiscal/accounting/outbox events
- Key files: `sales.service.ts`, `sale.repository.ts`, `returns.service.ts`, `sales.holds.service.ts`

#### Shifts (`modules/shifts/`)
- Route: `/api/v1/shifts`
- Purpose: Cashier shift lifecycle (open/close)
- Key: One open shift per cashier; cash variance computation; `SHIFT_ALERT` outbox on variance

#### Users (`modules/users/`)
- Route: `/api/v1/users`
- Purpose: User/employee management with role and tenant assignment

#### Org (`modules/org/`)
- Route: `/api/v1/org`
- Purpose: Business profile, branches, warehouses
- Key: Plan limits enforced on branch/warehouse creation; cascade deletion guards

#### Settings (`modules/settings/`)
- Route: `/api/v1/settings`
- Purpose: Tenant settings, currencies, tax categories, invoice templates

#### Platform Bootstrap (`modules/platform-bootstrap/`)
- Route: `/api/v1/platform-bootstrap`
- Purpose: One-time platform initialization (creates first `PLATFORM_SUPER_ADMIN`)
- Key: No auth required; token-based; one-time gate (HTTP 410 if already bootstrapped)

#### Access Requests (`modules/access-requests/`)
- Routes: `/api/v1/access-requests` (tenant), `/api/v1/platform/access-requests` (platform)
- Purpose: Plan changes, limit increases, feature access requests; platform overrides

#### Commerce (`modules/commerce/`)
- Route: `/api/v1/commerce`
- Purpose: Sales orders, e-commerce orders, deliveries, notifications

#### Finance (`modules/finance/`)
- Route: `/api/v1/finance`
- Purpose: Expenses, income, ledger payments, daily closing

#### Purchases (`modules/purchases/`)
- Route: `/api/v1/purchases`
- Purpose: Purchase orders, purchases, purchase returns, suppliers

#### Customers (`modules/customers/`)
- Route: `/api/v1/customers`
- Purpose: Customer CRUD, loyalty

#### Suppliers (`modules/suppliers/`)
- Route: `/api/v1/suppliers`
- Purpose: Supplier CRUD

#### SMS (`modules/sms/`)
- Route: `/api/v1/sms`
- Purpose: SMS settings, templates, logs, usage

#### Reports (`modules/reports/`)
- Route: `/api/v1/reports`
- Purpose: Business reports

#### Dashboard (`modules/dashboard/`)
- Route: `/api/v1/dashboard`
- Purpose: Dashboard data

#### Saas (`modules/saas/`)
- Route: `/api/v1/saas`
- Purpose: Subscription management

#### Platform Billing (`modules/platform-billing/`)
- Route: `/api/v1/platform-billing`
- Purpose: Platform invoices and billing

#### Plans (`modules/plans/`)
- Route: `/api/v1/platform/plans`
- Purpose: Plan management

#### Tenant Access (`modules/tenant-access/`)
- Route: `/api/v1/saas`
- Purpose: Tenant access management

#### Platform Override (`modules/platform-bootstrap/` related)
- Route: `/api/v1/platform/tenant-overrides`
- Purpose: Platform-level limit/feature overrides

#### Audit (`modules/audit/`)
- Route: `/api/v1/audit`
- Purpose: Audit log viewing

#### Notifications (`modules/notifications/`)
- Route: `/api/v1/extras/notifications`
- Purpose: Notification management

#### Extras (`modules/extras/`)
- Route: `/api/v1/extras`
- Purpose: Extra features

## Frontend (`frontend/`)

| Path | Purpose |
|------|---------|
| `app/` | Next.js App Router — pages, layouts, providers |
| `components/` | Shared UI components, layout, domain-specific |
| `lib/` | API client, auth hooks, state management, utilities |
| `app/page.tsx` | Redirects to `/login` |
| `app/layout.tsx` | Root layout with providers |
| `app/providers.tsx` | QueryProvider > ThemeProvider > AppToaster > NavigationProgress |
| `app/login/page.tsx` | Login page |
| `components/app-shell.tsx` | Main layout (sidebar + top bar + content) |
| `components/layout/app-sidebar.tsx` | Permission-filtered navigation |
| `components/layout/app-top-bar.tsx` | Breadcrumb, search, notifications, user menu |
| `components/erp-page.tsx` | Generic CRUD resource page |
| `components/ui/` | shadcn/ui components |
| `lib/api.ts` | Core API client with CSRF and idempotency |
| `lib/auth.ts` | `useMe()` hook, `can(permission)` |
| `lib/nav-config.ts` | Navigation groups and page metadata |
| `lib/use-list-state.ts` | Server-side pagination with URL sync |
| `lib/pos-store.ts` | Zustand POS cart store |
| `lib/money.ts` | Currency calculations (mirrors backend) |
| `lib/toast.ts` | Toast notification utilities |
| `lib/i18n.ts` | English/Bengali dictionaries |
| `lib/theme.ts` | Theme preference (light/dark/system) |
| `lib/sidebar-layout.ts` | Sidebar dimensions and animations |
| `lib/navigation-progress.ts` | Route progress bar |
| `lib/documents.ts` | Document printing/downloading |
