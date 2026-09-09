export function normalizeBdPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("880") && digits.length >= 13) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+88${digits}`;
  if (digits.startsWith("1") && digits.length === 10) return `+880${digits}`;
  if (digits.startsWith("88")) return `+${digits}`;
  return raw.trim();
}
