import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

function credentialKey() {
  const raw = process.env.SMS_CREDENTIALS_KEY || process.env.JWT_SECRET || "dev-sms-credentials-change-me";
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const [ivB64, tagB64, dataB64] = stored.slice(PREFIX.length).split(".");
  if (!ivB64 || !tagB64 || !dataB64) return null;
  const decipher = createDecipheriv("aes-256-gcm", credentialKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

const SECRET_KEYS = /api[_-]?key|api[_-]?secret|password|authorization|token|sid|auth/i;

export function sanitizeProviderText(value: unknown, depth = 0): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.slice(0, 800);
    return trimmed.replace(/(api[_-]?key|api[_-]?secret|password|authorization|token)\s*[:=]\s*["']?[^"'&\s,]+/gi, "$1=***");
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (depth > 3) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 8).map((v) => sanitizeProviderText(v, depth + 1)).join(",");
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.test(k) ? "***" : sanitizeProviderText(v, depth + 1);
    }
    return JSON.stringify(out).slice(0, 800);
  }
  return "";
}

export function publicSettingsMask(hasApiKey: boolean, hasApiSecret: boolean) {
  return { hasApiKey, hasApiSecret };
}
