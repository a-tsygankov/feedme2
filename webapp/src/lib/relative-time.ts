export function relativeTime(nowMs: number, thenMs: number | null): string {
  if (thenMs === null) return "never";
  const s = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 === 0 ? `${h} h ago` : `${h} h ${m % 60} m ago`;
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d} d ago` : `${d} d ${h % 24} h ago`;
}
