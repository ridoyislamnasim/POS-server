import { prisma } from "../../lib/prisma.js";

/** Post-commit processing. BullMQ will replace this polling stub. Never call from the sale transaction. */
export async function processOutboxBatch(limit = 20) {
  const events = await prisma.outboxEvent.findMany({
    where: { processedAt: null },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  for (const event of events) {
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { processedAt: new Date() },
    });
  }
  return events.length;
}
