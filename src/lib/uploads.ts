import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../uploads");

const MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function uploadsDir() {
  return root;
}

export async function saveDataUrl(dataUrl: string) {
  const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl.replace(/\s/g, ""));
  if (!m) throw Object.assign(new Error("Invalid image data"), { code: "VALIDATION" });
  const mime = m[1].toLowerCase();
  const ext = MIME[mime];
  if (!ext) throw Object.assign(new Error("Unsupported image type"), { code: "VALIDATION" });
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 4 * 1024 * 1024) throw Object.assign(new Error("Image must be under 4MB"), { code: "VALIDATION" });
  await fs.mkdir(root, { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  await fs.writeFile(path.join(root, name), buf);
  return `/uploads/${name}`;
}
