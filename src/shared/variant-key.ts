export function buildVariantKey(pairs: { key: string; value: string }[]): string {
  return pairs
    .map((p) => ({
      key: p.key.trim().toLowerCase(),
      value: p.value.trim().toLowerCase(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => `${p.key}:${p.value}`)
    .join("|");
}
