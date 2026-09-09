import { Redis } from "ioredis";

const url = process.env.REDIS_URL;
const required = Boolean(url) || process.env.REDIS_REQUIRED === "1";

let client: Redis | null = null;

export function redisRequired() {
  return required;
}

export async function pingRedis(): Promise<boolean> {
  if (!url) return !required;
  try {
    if (!client) client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
    if (client.status === "wait") await client.connect();
    const pong = await client.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}
