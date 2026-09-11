import { prisma } from "../../lib/prisma.js";
import { deliverSmsLog } from "./sms.service.js";

export async function processSmsRetryBatch(limit = 20) {
  const cutoff = new Date(Date.now() - 30_000);
  const rows = await prisma.smsLog.findMany({
    where: {
      retryable: true,
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: 3 },
      updatedAt: { lte: cutoff },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true, tenantId: true },
  });
  for (const row of rows) {
    try {
      await deliverSmsLog(row.id, row.tenantId);
    } catch (e) {
      console.warn("SMS retry failed", row.id, e instanceof Error ? e.message : e);
    }
  }
  return rows.length;
}

export function startSmsPoller(intervalMs = 15_000) {
  const tick = () => {
    processSmsRetryBatch().catch((e) => console.warn("SMS poll failed", e));
  };
  tick();
  return setInterval(tick, intervalMs);
}
