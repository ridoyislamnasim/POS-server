# Architecture

## Overview

Multi-tenant POS SaaS with a layered backend and a Next.js frontend.

## Request Flow

```
Frontend (Next.js)
  → API Client (fetch wrapper with CSRF, idempotency keys)
    → Express Route (/api/v1/{module})
      → Middleware (request-id, csrf, requireAuth, requireTenant, requirePermission, validate)
        → Controller (HTTP-only, extracts ctx, calls service)
          → Service (business logic, accepts RequestContext)
            → Repository (Prisma queries)
              → Prisma Client
                → PostgreSQL
```

## Backend

### Entry Points
- `src/index.ts` — Bootstrap: loads dotenv, ensures indexes, syncs permissions, starts Express and outbox/SMS pollers
- `src/app.ts` — `createApp()`: configures Express middleware (CORS, JSON, cookie-parser, CSRF), registers routes, error handling
- `src/app/routes.ts` — Mounts every module router under `/api/v1/*`

### Middleware Chain (per route)
1. `requestContext` — Assigns `requestId`/`correlationId`
2. `csrfProtect` — Validates CSRF token on state-changing requests
3. `requireAuth` — Decodes JWT, loads user/tenants/roles/branches, builds `RequestContext`
4. `requireTenant` — Ensures `tenantId` exists (or user is platform actor)
5. `requirePermission(key)` — Checks permission or platform/owner role
6. `validateBody/query/params` — Zod validation
7. Controller handler

### Auth & Session
- JWT access token (8h) contains `{ sub, tenantId, sid }`
- Refresh token (7d) stored hashed in `Session` table
- Cookies: `pos_access` (access), `pos_refresh` (refresh), `pos_csrf` (CSRF)
- Platform users (`PLATFORM_SUPER_ADMIN`) can operate with null `tenantId`
- Tenant users auto-resolve to their membership; must have valid tenant association
- Account lockout after 8 failed login attempts within 15 minutes

### Profile Management
- `GET /api/v1/auth/profile` — Returns `{ id, name, email, locale, imageUrl }`
- `PATCH /api/v1/auth/profile` — Updates `name` and/or `imageUrl` (optional fields)
- `POST /api/v1/auth/profile/image` — Uploads avatar via base64 data URL; saved to `/uploads/`
- `POST /api/v1/auth/change-password` — Validates current password, hashes new with bcrypt (12 rounds); min 8 chars
- `User` model has `imageUrl: String?` field for avatar storage

### Tenant Resolution
- `requireAuth` resolves `tenantId` from JWT → user membership → `RequestContext`
- `tenantFilter(ctx)` returns `{}` for platform, `{ tenantId }` for tenant-scoped
- `visibleUsersWhere(ctx)` restricts user queries to same-tenant non-platform-admin users
- `visibleMembershipWhere(ctx)` restricts membership queries to current tenant
- `branchWhere(ctx)` / `branchScope(ctx)` adds `branchId` filtering

## Frontend

### Structure
- `frontend/app/` — Next.js App Router pages and layouts
- `frontend/components/` — Shared UI (shadcn/ui, layout, domain-specific)
- `frontend/lib/` — API client, auth hooks, state, utilities

### Data Flow
```
Page Component
  → useQuery/useMutation (TanStack Query)
    → api.ts (fetch wrapper)
      → Backend REST API
```

### Key Frontend Files
- `frontend/lib/api.ts` — Core API client (CSRF, idempotency, error handling)
- `frontend/lib/auth.ts` — `useMe()` hook, `can(permission)` helper
- `frontend/lib/query-client.ts` — React Query client setup
- `frontend/lib/nav-config.ts` — Navigation groups and page titles
- `frontend/lib/use-list-state.ts` — Server-side list state with URL sync
- `frontend/components/erp-page.tsx` — Generic CRUD resource page
- `frontend/components/layout/app-sidebar.tsx` — Permission-filtered sidebar

## Error Handling
- All errors use the envelope format: `{ success: false, error: { code, message, details? } }`
- `AppError` from `src/utils/errors.ts` with codes: `VALIDATION`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INSUFFICIENT_STOCK`, `SHIFT_REQUIRED`, `PLAN_LIMIT_REACHED`, `SUBSCRIPTION_SUSPENDED`, etc.
- `errorMiddleware` maps Prisma `P2002` constraint violations to specific conflict codes
- 404 handled by `notFoundMiddleware`

## Outbox Pattern
- Events written to `OutboxEvent` table for async processing
- Used for: `STAFF_CREATED`, `ROLE_CHANGED`, `SALE_CREATED`, `SHIFT_ALERT`, etc.
- Outbox poller processes events periodically
