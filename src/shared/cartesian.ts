export function cartesian<T>(lists: T[][]): T[][] {
  if (!lists.length) return [[]];
  return lists.reduce<T[][]>((acc, list) => acc.flatMap((prefix) => list.map((item) => [...prefix, item])), [[]]);
}

export function slugify(input: string) {
  const s = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "item";
}

export function makeSku(productCode: string, parts: string[]) {
  const tail = parts
    .map((p) =>
      p
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join("-");
  const base = String(productCode).trim().toUpperCase();
  return tail ? `${base}-${tail}` : base;
}

export function randomBarcode() {
  return `${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0")}`;
}

export const DEFAULT_VARIANT_KEY = "__default__";
