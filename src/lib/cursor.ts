const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

export type Cursor = { createdAt: string; id: string };

export function parseLimit(raw: unknown): number {
  const n = Number(raw ?? DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(n), MAX_LIMIT);
}

export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), "utf8").toString(
    "base64url",
  );
}

export function decodeCursor(raw: unknown): Cursor | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Cursor;
    if (!parsed.createdAt || !parsed.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function cursorWhere(cursor: Cursor | null):
  | {
      OR: [
        { createdAt: { lt: Date } },
        { createdAt: Date; id: { lt: string } },
      ];
    }
  | Record<string, never> {
  if (!cursor) return {};
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: cursor.id } }],
  };
}

export function pageMeta<T extends { createdAt: Date; id: string }>(rows: T[], limit: number) {
  const nextCursor = rows.length === limit ? encodeCursor(rows[rows.length - 1].createdAt, rows[rows.length - 1].id) : null;
  return { limit, nextCursor };
}
