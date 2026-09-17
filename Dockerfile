# Backend Dockerfile
# Multi-stage build: compile TypeScript + Prisma, then run with node

FROM node:22-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Install dependencies (including devDependencies for Prisma)
RUN pnpm install --frozen-lockfile

# Copy source and scripts
COPY tsconfig.json ./
COPY scripts/ ./scripts/
COPY prisma/ ./prisma/
COPY src/ ./src/

# Unlock Prisma engine and generate client
RUN node scripts/unlock-prisma-engine.mjs && \
    pnpm db:generate && \
    pnpm build

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy only production dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/scripts ./scripts

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/health || exit 1

EXPOSE 4000

CMD ["node", "dist/index.js"]
