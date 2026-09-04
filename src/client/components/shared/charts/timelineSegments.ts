export interface Sample<T> {
  timeMs: number;
  value: T;
}

export interface TimelineSegment {
  startMs: number;
  endMs: number;
  color: string;
  label: string;
}

/**
 * Turns a series of point-in-time samples (one tick decision's worth of
 * state at a time) into contiguous segments — each sample's value is
 * assumed to hold until the next sample, since tick decisions are only
 * logged when a tick actually runs (a step function, not a continuous
 * signal). `domainEndMs` closes out the final segment. Backs
 * HvacStateTimeline and SpikeEventTimeline — both are "which categorical
 * state was true over this stretch" views on the same tick-history data.
 */
export function buildStepSegments<T>(
  samples: Sample<T>[],
  domainEndMs: number,
  colorFn: (value: T) => string,
  labelFn: (value: T) => string,
): TimelineSegment[] {
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const segments: TimelineSegment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i].timeMs;
    const end = i + 1 < sorted.length ? sorted[i + 1].timeMs : domainEndMs;
    if (end <= start) continue;
    segments.push({
      startMs: start,
      endMs: end,
      color: colorFn(sorted[i].value),
      label: labelFn(sorted[i].value),
    });
  }
  return segments;
}

export interface BooleanPeriod {
  startMs: number;
  endMs: number;
}

/**
 * The boolean-specific sibling of `buildStepSegments` — collapses adjacent
 * `true` samples into single periods (rather than one segment per sample),
 * which is what DegradedVentHistory/EquipmentFaultLog's historical-period
 * lists actually want to render ("degraded for 12m, ending 2h ago"), not a
 * colored timeline bar.
 */
export function computeTruePeriods(
  samples: Sample<boolean>[],
  domainEndMs: number,
): BooleanPeriod[] {
  const sorted = [...samples].sort((a, b) => a.timeMs - b.timeMs);
  const periods: BooleanPeriod[] = [];
  let openStart: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    const { timeMs, value } = sorted[i];
    if (value && openStart === null) {
      openStart = timeMs;
    } else if (!value && openStart !== null) {
      periods.push({ startMs: openStart, endMs: timeMs });
      openStart = null;
    }
  }
  if (openStart !== null) {
    periods.push({ startMs: openStart, endMs: domainEndMs });
  }
  return periods;
}
