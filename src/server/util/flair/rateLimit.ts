// Reads how long to wait before retrying a 429 response — respects the
// server's own Retry-After (seconds, or an HTTP date) when present, since
// that's a better signal than a fixed guess.
export function getRetryAfterMs(res: {
  headers: { get(name: string): string | null };
}): number | null {
  const header = res.headers.get("Retry-After");
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}
