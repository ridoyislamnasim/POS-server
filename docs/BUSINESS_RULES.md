# Business Rules

## Multi-tenancy & Access Control

- Every data operation is scoped by `tenantId`. Platform users (`PLATFORM_SUPER_ADMIN`) can bypass tenant filtering.
- `PLATFORM_SUPER_ADMIN` can access platform-level resources without a `tenantId`.
- Tenant users without an explicit `tenantId` in their JWT auto-resolve to their first non-platform membership.
- If a tenant's `apiAccessEnabled` is `false`, API requests return `402 PAYMENT_REQUIRED`.
- `requireTenant` middleware rejects requests without `tenantId` for non-platform users.

## Roles & Permissions

- RBAC via `User → UserRole → Role → RolePermission → Permission`.
- `PLATFORM_SUPER_ADMIN` role key is platform-level; `TENANT_OWNER` is auto-bootstrapped per tenant.
- Roles are unique by `[tenantId, key]` — platform roles have `tenantId: null`.
- Only `PLATFORM_SUPER_ADMIN` can create, update, delete roles.
- `hasPermission(ctx, key)` returns true for platform users, `TENANT_OWNER`, or users with the permission.
- Permission list defined in `src/shared/permissions.ts`: `Permissions`, `MANAGER_KEYS`, `CASHIER_KEYS`.

## Authentication

- JWT access token: 8h expiry, contains `{ sub, tenantId, sid }`.
- Refresh token: 7d expiry, stored hashed in `Session` table.
- Account lockout: 8 failed login attempts within 15 minutes → 429 error.
- CSRF token (`pos_csrf`) required on all state-changing POST/PUT/PATCH/DELETE requests.
- Cookie-based auth with `httpOnly`, `secure` (in production), `sameSite=lax`.

## Catalog

- Products have `tenantId` and are scoped to their tenant.
- Product variants have `[tenantId, sku]` uniqueness and `[productId, variantKey]` uniqueness.
- SKU generation: `{productCode}-{optionValues}`.
- Barcodes are unique per tenant-variant, can be primary or secondary.
- Category/brand/unit/subcategory are all tenant-scoped.
- `assertUniqueSku`, `assertUniqueBarcode`, `assertUniqueProductCode` guard uniqueness.

## Inventory

- Stock is tracked per `[tenantId, locationId, channel, variantId]` with buckets: AVAILABLE, DAMAGED, QUARANTINE.
- Available = ONHAND - RESERVED.
- Stock movements are append-only (never updated/deleted).
- Negative stock policy is per-branch: `BLOCK` or `ALLOW`.
- Stock takes compare counted vs system quantities and create variance adjustments.
- Damage approval moves available stock to damaged bucket based on branch policy.
- Reservations prevent over-reservation of stock.

## Sales

- Open shift is required to create a sale (same register/cashier).
- Invoice numbers are atomic via `DocumentNumberSequence` table with retry on collision.
- Discount > 10% requires `discount.approve` permission.
- Credit sales require a customer and enforce credit limit.
- Sale statuses: `DRAFT`, `COMPLETED`, `VOIDED`, `PARTIALLY_RETURNED`, `FULLY_RETURNED`.
- Voiding restores stock and clawbacks loyalty points. Only `COMPLETED` sales can be voided.
- Returns track remaining returnable quantity per line item. Condition determines restocking bucket.
- Idempotency keys prevent duplicate sales/returns.
- Fiscal documents and accounting events are created for every sale.
- Loyalty points earned on completed sales (1 point per 100 currency units).

## Shifts

- One open shift per cashier at a time.
- Shift close computes variance: `Expected = OpeningFloat + CashSales`, `Variance = Closing - Expected`.
- If `|variance| >= 1`, a `SHIFT_ALERT` outbox event is enqueued.
- Only the shift's cashier can close it (unless platform/admin with `allBranches`).

## Organization

- Branches are created with a location (STORE or WAREHOUSE type), a default register, and a document number sequence.
- Branch creation is constrained by plan limits (`maxBranches`).
- Warehouse creation is constrained by plan limits (`maxWarehouses`).
- Branch deletion guards: cannot delete if branch has sales, assigned users, or shift history.
- Warehouse deletion guards: cannot delete if warehouse has stock.

## Users

- `TENANT_OWNER` role is auto-bootstrapped with all permissions on first user creation in a tenant.
- Only platform users can assign `PLATFORM_SUPER_ADMIN` or `TENANT_OWNER` roles.
- `TENANT_OWNER` cannot have their role changed by non-platform users.
- Platform users must specify `tenantId` when creating users.
- `TENANT_OWNER` gets `allBranches: true` membership.
- Deactivation triggers `STAFF_DEACTIVATED` outbox event.

## Plan & Subscription

- Plan limits (`maxBranches`, `maxUsers`, `maxProducts`, `maxWarehouses`) are enforced via `PlanLimit` table.
- Feature flags (`planFeatures`) control feature availability.
- `planLimits(ctx)` and `requirePlanLimit(resource)` / `requirePlanFeature(feature)` enforce limits.
- Tenant limit overrides and feature overrides create an audit trail (previous overrides marked `current: false`).

## Idempotency

- Sales use `clientTransactionId + deviceId` for uniqueness.
- `IdempotencyRecord` table tracks pending/completed requests.
- Idempotent replays return the original response without re-processing.

## Document Numbering

- Document numbers follow `PREFIX-YYYY-NNNNNN` format (6-digit padding).
- Sequences are per `[tenantId, branchId, documentType, fiscalYear]`.
- `nextDocNumber` and `nextDocNumberTx` handle atomic increment with race condition handling.

## Money

- All monetary calculations use `decimal.js` with `ROUND_HALF_UP` precision 20.
- Locked rounding order: unit → line discount → taxable → tax → line round → invoice total.
- Never use native JavaScript floats for money.

## Profile

- `GET /profile` returns `{ id, name, email, locale, imageUrl }` for the authenticated user.
- `PATCH /profile` allows updating `name` and/or `imageUrl` (both optional).
- `POST /profile/image` accepts base64 data URL, validates MIME type (JPEG/PNG/GIF/WebP), max 4MB, saves to `/uploads/`.
- `POST /change-password` requires current password verification via bcrypt, new password minimum 8 characters, hashes new password with bcrypt (12 rounds).
- All profile operations are tenant-scoped via `requireAuth` middleware.

## Auditing

- Every significant action writes an `AuditLog` entry via `writeAudit()`.
- Audit log fields: `tenantId`, `userId`, `actorUserId`, `action`, `entityType`, `entityId`, `before`, `after`, `ip`, `userAgent`, `requestId`, `correlationId`.
