/**
 * "3m ago" / "2h ago" / "5d ago" — shared by every Diagnostics panel that
 * shows how long something has been true (a stale reading, a degraded
 * vent, an active fault). `nowMs` is an explicit parameter, not
 * `Date.now()` internally, so this stays trivially testable without fake
 * timers — the same convention used throughout this project's domain code.
 */
export function formatElapsed(sinceIso: string, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - new Date(sinceIso).getTime());
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
