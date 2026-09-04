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
