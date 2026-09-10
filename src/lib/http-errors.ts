import { Prisma } from "@prisma/client";

export function d(n: Prisma.Decimal | string | number) {
  return new Prisma.Decimal(n);
}

export function validation(message: string): never {
  throw Object.assign(new Error(message), { code: "VALIDATION" });
}

export function notFound(message: string): never {
  throw Object.assign(new Error(message), { code: "NOT_FOUND" });
}

export function conflict(message: string): never {
  throw Object.assign(new Error(message), { code: "CONFLICT" });
}

export function asJson(body: unknown): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(body, (_k, v) => {
      if (v instanceof Prisma.Decimal) return v.toString();
      if (v instanceof Date) return v.toISOString();
      return v;
    }),
  ) as Prisma.InputJsonValue;
}

export async function replayOrBegin(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; key?: string | null; method: string; path: string },
): Promise<{ replay: true; body: unknown } | { replay: false }> {
  if (!input.key) return { replay: false };
  const existing = await tx.idempotencyRecord.findUnique({
    where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
  });
  if (existing) {
    const pending = existing.status === 0 || Boolean((existing.body as { pending?: boolean } | null)?.pending);
    if (pending) conflict("A matching request is already in progress. Retry in a moment.");
    return { replay: true, body: existing.body };
  }
  try {
    await tx.idempotencyRecord.create({
      data: {
        tenantId: input.tenantId,
        key: input.key,
        method: input.method,
        path: input.path,
        status: 0,
        body: { pending: true },
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await tx.idempotencyRecord.findUnique({
        where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
      });
      if (row && !(row.body as { pending?: boolean } | null)?.pending) {
        return { replay: true, body: row.body };
      }
      conflict("A matching request is already in progress. Retry in a moment.");
    }
    throw e;
  }
  return { replay: false };
}

export async function completeIdempotency(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; key?: string | null; status: number; body: unknown },
) {
  if (!input.key) return;
  await tx.idempotencyRecord.update({
    where: { tenantId_key: { tenantId: input.tenantId, key: input.key } },
    data: { status: input.status, body: asJson(input.body) },
  });
}

export async function abortIdempotency(
  tx: Prisma.TransactionClient,
  input: { tenantId: string; key?: string | null },
) {
  if (!input.key) return;
  await tx.idempotencyRecord.deleteMany({
    where: { tenantId: input.tenantId, key: input.key },
  });
}
