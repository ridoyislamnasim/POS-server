import { Router } from "express";
import { requirePermission } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { notificationController } from "./notification.controller.js";
import { sendNotificationSchema } from "./notification.validation.js";

export const notificationRouter = Router();

notificationRouter.get("/unread-count", requirePermission("notification.view"), notificationController.unreadCount);
notificationRouter.get("/recent", requirePermission("notification.view"), notificationController.recent);
notificationRouter.post("/read-all", requirePermission("notification.view"), notificationController.readAll);
notificationRouter.post("/low-stock", requirePermission("notification.send"), notificationController.rescanLowStock);
notificationRouter.patch("/:id/read", requirePermission("notification.view"), notificationController.markRead);
notificationRouter.get("/", requirePermission("notification.view"), notificationController.list);
notificationRouter.post("/", requirePermission("notification.send"), validateBody(sendNotificationSchema), notificationController.send);
