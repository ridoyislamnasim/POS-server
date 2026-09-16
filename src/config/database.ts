/**
 * Canonical database-access entry point.
 * `lib/prisma.ts` remains the singleton; import from here in new
 * repository code so the direction stays Service -> Repository -> Prisma.
 */
export { prisma } from "../lib/prisma.js";
export type { Prisma } from "@prisma/client";
export { Prisma as PrismaNS } from "@prisma/client";
