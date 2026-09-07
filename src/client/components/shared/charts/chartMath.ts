// Ported verbatim from tesla-powerwall-automation's own chart building
// blocks (see "Stage 13, Increment B" in the implementation plan) — this
// helper is fully generic, no changes needed for HVAC-shaped data.
export function niceTickInterval(dataMin: number, dataMax: number): number {
  const range = Math.max(Math.abs(dataMax - dataMin), 1);
  const rough = range / 5;
  const exp = Math.floor(Math.log10(rough));
  const frac = rough / Math.pow(10, exp);
  const niceFrac = frac <= 1.5 ? 1 : frac <= 3 ? 2 : frac <= 7 ? 5 : 10;
  return niceFrac * Math.pow(10, exp);
}

/**
 * How many decimal places a Y-axis tick label needs to actually
 * distinguish adjacent ticks spaced `interval` apart — 0 for a
 * whole-number-or-coarser interval (e.g. 1, 2, 5, 50), scaling up for a
 * sub-1 interval (1 for 0.5/0.2/0.1, 2 for 0.05/0.02, etc). A fixed "0 or 1
 * decimal" rule isn't enough on its own: `niceTickInterval` can return any
 * `niceFrac * 10^exp` (niceFrac ∈ {1,2,5,10}), so a narrow enough data
 * range produces an interval smaller than 0.1 too. Found live: a Y-axis
 * with a real 0.5° tick interval showed "75°F, 74°F, 74°F, 73°F, 73°F..." —
 * every tick rounded to a whole degree regardless of the real interval,
 * so adjacent ticks 0.5° apart rendered as duplicate-looking labels.
 */
export function tickDecimalsForInterval(interval: number): number {
  if (!Number.isFinite(interval) || interval <= 0) return 0;
  return Math.max(0, -Math.floor(Math.log10(interval)));
}
