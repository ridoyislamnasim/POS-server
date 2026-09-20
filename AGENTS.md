# AGENTS.md

## Project Overview

Multi-tenant POS SaaS application. Backend is Express/TypeScript/Prisma/PostgreSQL; frontend is Next.js/React/TypeScript/Tailwind. Both use pnpm.

## Stack

### Backend
- Express, TypeScript, Prisma, PostgreSQL, pnpm
- Entry: `src/index.ts` → `src/app.ts` → `registerRoutes()`
- Test runner: Vitest (`vitest run`)

### Frontend
- Next.js 15, React 19, TypeScript, Tailwind, pnpm
- App Router at `frontend/app/`
- State: TanStack Query v5 + Zustand
- API client: `frontend/lib/api.ts`

## Architecture

```
Frontend → API Client → Express Route → Middleware → Controller → Service → Repository → Prisma → PostgreSQL
```

## Multi-tenancy

- Every tenant-scoped request must respect `tenantId`.
- `PLATFORM_SUPER_ADMIN` is the only role that can access platform-level resources without `tenantId`.
- Never remove tenant isolation to solve a query error.
- `RequestContext` (`ctx`) is attached to `req.ctx` by `requireAuth` middleware and carries: `userId`, `tenantId`, `isPlatform`, `branchIds`, `allBranches`, `permissions`, `roles`, `businessDate`.

## Before Changing Code

1. Inspect the relevant existing module.
2. Trace the complete flow: route → controller → service → repository → Prisma.
3. Inspect related frontend API/query/hooks/components.
4. Inspect Prisma schema/models involved.
5. Search for existing implementations before creating new ones.
6. Reuse existing patterns.
7. Do not rebuild existing modules from scratch.

## Database Rules

- Do not run `prisma migrate`.
- Do not run `prisma db push`.
- Do not modify production data.
- Prisma schema changes are allowed.
- Run `prisma generate` after schema changes.
- Ask before any migration or database push.

## Testing

After changes:
1. Run relevant typecheck.
2. Run relevant tests.
3. Run build if appropriate.
4. Report exactly what was changed and tested.

## Coding Style

- Keep changes minimal.
- Do not introduce unnecessary dependencies.
- Do not duplicate existing business logic.
- Do not change unrelated modules.

## Key Patterns

- **Module structure**: `{module}/index.ts`, `{module}.routes.ts`, `{module}.controller.ts`, `{module}.service.ts`, `{module}.repository.ts`, `{module}.types.ts`, `{module}.validation.ts`
- **Controller**: HTTP-only, calls services, uses `ok`/`okList`/`fail` from `utils/response.ts`
- **Service**: Business logic, accepts `RequestContext`, no Express `req`/`res`
- **Repository**: Pure Prisma queries, no business rules
- **Shared lib**: `lib/scope.ts` (tenant filtering), `lib/list-query.ts` (pagination), `lib/erp.ts` (tenant/branch helpers), `lib/audit.ts` (audit logging)
- **Permissions**: `shared/permissions.ts` exports `Permissions`, `MANAGER_KEYS`, `CASHIER_KEYS`
- **Auth middleware**: `src/middleware/auth.ts` — `requireAuth`, `requireTenant`, `requirePermission(key)`, `requirePlatformSuperAdmin`
- **Validation**: Zod schemas in `src/middleware/validate.ts` (`validateBody`, `validateQuery`, `validateParams`)
- **Error handling**: `AppError` from `src/utils/errors.ts`, mapped in `src/middleware/error.middleware.ts`
- **Response envelope**: `ok`/`okList`/`fail` from `lib/envelope.ts`
- **CSRF**: Cookie-based (`pos_csrf`, `pos_access`, `pos_refresh`)
- **Idempotency**: `src/lib/http-errors.ts` provides idempotency key lifecycle

## Profile & Auth Features

### Profile Management (`/api/v1/auth/profile`)
- `GET /profile` — Returns current user's profile (`{ id, name, email, locale, imageUrl }`)
- `PATCH /profile` — Updates name and/or imageUrl (`{ name?: string, imageUrl?: string | null }`)
- `POST /profile/image` — Uploads avatar via base64 data URL in `{ image: string }` body; saves to `/uploads/`, returns updated profile
- `POST /change-password` — Changes password; validates current password, hashes new with bcrypt (12 rounds); requires `{ currentPassword, newPassword }` (min 8 chars)

### Prisma Schema
- `User` model has `imageUrl: String?` field for avatar storage
