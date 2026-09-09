# POS Backend (Express)

Standalone API. Port **4000**. Prisma + PostgreSQL live here only.

```bash
cd backend
pnpm install
# set DATABASE_URL in .env
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Health: http://localhost:4000/api/health
# POS-server
