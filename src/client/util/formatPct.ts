/**
 * Formats a position percentage for display, rounded to a whole number.
 * Every raw `*_position_pct` field (desired/post-contention/commanded/
 * reported) is a float from the real Step 1-3 math — interpolated directly
 * it prints with the full ~15 unrounded significant digits a double carries
 * (e.g. "29.123580267841994"), which is noise no one needs at this display
 * granularity. Returns the same "—" placeholder already used everywhere
 * else in these components a value might be absent.
 */
export function formatPct(value: number | null | undefined): string {
  return typeof value === "number" ? value.toFixed(0) : "—";
}
