import type { Prisma, PrismaClient } from "@prisma/client";
import { asJson } from "../../lib/http-errors.js";

export async function enqueueOutbox(
  tx: Prisma.TransactionClient | PrismaClient,
  input: {
    tenantId: string;
    type: string;
    aggregateId?: string;
    payload?: unknown;
    correlationId?: string;
  },
) {
  return tx.outboxEvent.create({
    data: {
      tenantId: input.tenantId,
      type: input.type,
      eventType: input.type,
      aggregateId: input.aggregateId,
      payload: asJson(input.payload ?? {}),
      correlationId: input.correlationId ?? input.aggregateId ?? `${input.type}:${Date.now()}`,
    },
  });
}
