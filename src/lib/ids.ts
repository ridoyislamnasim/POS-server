import { randomUUID } from "node:crypto";

export function requestId() {
  return randomUUID();
}
