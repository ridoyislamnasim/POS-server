import "dotenv/config";
import { createApp } from "./app.js";
import { ensurePartialIndexes } from "./lib/ensure-indexes.js";
import { syncPermissions } from "./lib/permissions-sync.js";
import { backfillLegacyNotifications } from "./modules/notifications/notification.service.js";
import { startOutboxPoller } from "./modules/outbox/worker.js";

const port = Number(process.env.PORT ?? 4000);

await ensurePartialIndexes().catch((e) => {
  console.warn("Index ensure skipped", e);
});
await syncPermissions().catch((e) => {
  console.warn("Permission sync skipped", e);
});
await backfillLegacyNotifications().catch((e) => {
  console.warn("Notification backfill skipped", e);
});

createApp().listen(port, () => {
  console.log(`POS API http://localhost:${port}`);
  startOutboxPoller(5000);
});
