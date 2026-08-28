export type ContentionBucket = "spiking" | "occupied" | "unoccupied";

export interface ContentionZone {
  zoneId: string;
  desiredPosition: number;
  floorPosition: number; // max(idle_baseline_position, min_vent_position)
  flowRateLps: number;
  priorityRank: number; // Infinity if absent from the active priority list
  bucket: ContentionBucket;
}

const BUCKET_ORDER: Record<ContentionBucket, number> = {
  spiking: 0,
  occupied: 1,
  unoccupied: 2,
};

/**
 * Bucket-major ranking (spiking → occupied → unoccupied), tie-broken by
 * priority order — zones absent from the active priority list are
 * appended after, in original order (Infinity rank). See "Step 3 —
 * contention resolution". The spiking bucket's privilege is scoped by the
 * caller to COOLING_CALL only (a spiking zone in HEATING_CALL is already
 * choked by Step 1); the occupied bucket's privilege applies in both
 * states — see "Occupancy".
 */
export function rankZones(zones: ContentionZone[]): ContentionZone[] {
  return [...zones].sort((a, b) => {
    const bucketDiff = BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket];
    if (bucketDiff !== 0) return bucketDiff;
    return a.priorityRank - b.priorityRank;
  });
}

export interface ContentionResult {
  positions: Record<string, number>; // zoneId -> reduced desiredPosition, only for changed zones
  reductions: Record<string, number>;
  insufficient: boolean;
}

/**
 * Triggered only when the flow-rate-weighted sum of demanding zones'
 * desired positions would exceed `capLps` (the topology's maximum
 * aggregate demand — see "Pressure safeguard"). Reduces zones toward their
 * own floor, walking the ranking in reverse (lowest-priority first),
 * bounding each step so the aggregate never drops below `capLps` inside
 * the loop. If every zone at its floor still isn't enough, `insufficient`
 * is true — logged as a likely-misconfiguration warning, never silently
 * over-closed.
 */
export function resolveContention(
  ranked: ContentionZone[],
  capLps: number,
): ContentionResult {
  const working = ranked.map((z) => ({ ...z }));
  let currentTotalLps = working.reduce(
    (sum, z) => sum + (z.desiredPosition / 100) * z.flowRateLps,
    0,
  );

  const positions: Record<string, number> = {};
  const reductions: Record<string, number> = {};

  if (currentTotalLps <= capLps) {
    return { positions, reductions, insufficient: false };
  }

  for (let i = working.length - 1; i >= 0 && currentTotalLps > capLps; i--) {
    const zone = working[i];
    if (zone.desiredPosition <= zone.floorPosition) continue;
    const excessLps = currentTotalLps - capLps;
    const maxReducibleLps =
      ((zone.desiredPosition - zone.floorPosition) / 100) * zone.flowRateLps;
    const reduceLps = Math.min(excessLps, maxReducibleLps);
    const reducePct =
      zone.flowRateLps > 0 ? (reduceLps / zone.flowRateLps) * 100 : 0;
    const newPosition = zone.desiredPosition - reducePct;
    positions[zone.zoneId] = newPosition;
    reductions[zone.zoneId] = reducePct;
    zone.desiredPosition = newPosition;
    currentTotalLps -= reduceLps;
  }

  return { positions, reductions, insufficient: currentTotalLps > capLps };
}
