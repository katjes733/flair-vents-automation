export interface SpikeReading {
  timestampMs: number;
  temperatureC: number;
}

export interface SpikeHysteresisState {
  spiking: boolean;
  belowThresholdSinceMs: number | null;
}

export interface SpikeEvaluation extends SpikeHysteresisState {
  ratePerMin: number | null;
}

function leastSquaresSlopePerMinute(readings: SpikeReading[]): number {
  const t0 = readings[0].timestampMs;
  const xs = readings.map((r) => (r.timestampMs - t0) / 60000);
  const ys = readings.map((r) => r.temperatureC);
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function hasImplausibleJump(
  readings: SpikeReading[],
  plausibilityCapPerMin: number,
): boolean {
  for (let i = 1; i < readings.length; i++) {
    const dtMin =
      (readings[i].timestampMs - readings[i - 1].timestampMs) / 60000;
    if (dtMin <= 0) continue;
    const rate =
      Math.abs(readings[i].temperatureC - readings[i - 1].temperatureC) / dtMin;
    if (rate > plausibilityCapPerMin) return true;
  }
  return false;
}

/**
 * Rate-of-rise via least-squares slope over true timestamps — not
 * first-vs-last, which is exactly what would misread a delayed-then-
 * caught-up reading as artificially steep. `readings` is assumed already
 * deduped (the real Redis ZSET's ZADD-idempotent-on-identical-score+member
 * behavior handles that upstream — see "Dynamic thermal spike detection").
 * A minimum sample count/span guards against trusting a slope computed
 * from too little data, and a plausibility cap rejects any pairwise jump
 * implying an unrealistic rate (a sync-recovery artifact, not physics).
 * Hysteresis (separate rise/clear thresholds + a stabilization dwell)
 * prevents flapping.
 */
export function evaluateSpike(params: {
  readings: SpikeReading[];
  minSamples: number;
  minSpanMinutes: number;
  riseThresholdPerMin: number;
  clearThresholdPerMin: number;
  plausibilityCapPerMin: number;
  previous: SpikeHysteresisState;
  nowMs: number;
  stabilizationMinutes: number;
}): SpikeEvaluation {
  const spanMinutes =
    params.readings.length >= 2
      ? (params.readings[params.readings.length - 1].timestampMs -
          params.readings[0].timestampMs) /
        60000
      : 0;

  if (
    params.readings.length < params.minSamples ||
    spanMinutes < params.minSpanMinutes ||
    hasImplausibleJump(params.readings, params.plausibilityCapPerMin)
  ) {
    return { ...params.previous, ratePerMin: null };
  }

  const rate = leastSquaresSlopePerMinute(params.readings);

  if (rate >= params.riseThresholdPerMin) {
    return { spiking: true, belowThresholdSinceMs: null, ratePerMin: rate };
  }

  if (rate < params.clearThresholdPerMin) {
    if (!params.previous.spiking) {
      return { spiking: false, belowThresholdSinceMs: null, ratePerMin: rate };
    }
    const since = params.previous.belowThresholdSinceMs ?? params.nowMs;
    const dwellElapsed = (params.nowMs - since) / 60000;
    if (dwellElapsed >= params.stabilizationMinutes) {
      return { spiking: false, belowThresholdSinceMs: null, ratePerMin: rate };
    }
    return { spiking: true, belowThresholdSinceMs: since, ratePerMin: rate };
  }

  return {
    spiking: params.previous.spiking,
    belowThresholdSinceMs: null,
    ratePerMin: rate,
  };
}
