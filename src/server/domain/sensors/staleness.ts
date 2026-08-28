import type { ZoneClassification } from "~/server/domain/types";

export interface StalenessResult {
  stale: boolean;
}

/**
 * A zone is stale once its reading hasn't changed for longer than the
 * configured threshold (default 15 minutes) — except a zone already
 * classified `satisfied` on the *previous* tick never trips the check,
 * since a comfortable room's reading is unchanging by design; flagging
 * that as staleness would false-positive on every comfortable room in the
 * house. See "Stale sensor reading safeguard".
 */
export function classifyStaleness(params: {
  lastReadingChangedAtMs: number | null;
  nowMs: number;
  staleThresholdMinutes: number;
  previousClassification: ZoneClassification | null;
}): StalenessResult {
  if (params.previousClassification === "satisfied") {
    return { stale: false };
  }
  if (params.lastReadingChangedAtMs === null) {
    return { stale: false };
  }
  const ageMinutes = (params.nowMs - params.lastReadingChangedAtMs) / 60000;
  return { stale: ageMinutes >= params.staleThresholdMinutes };
}
