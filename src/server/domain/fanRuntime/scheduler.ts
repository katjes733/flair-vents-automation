import moment from "moment-timezone";

export type FanRuntimeKind = "heat_cool" | "fan_only";

export interface RuntimeInterval {
  startMs: number;
  endMs: number;
  kind: FanRuntimeKind;
}

export interface HourlyRuntime {
  hourStartMs: number;
  heatCoolSeconds: number;
  fanOnlySeconds: number;
  creditedSeconds: number;
}

export interface FanBlockPolicy {
  minBlockMinutes: number;
  maxBlockMinutes: number;
  maxStartsPerHour: number;
  minGapMinutes: number;
  maxTargetMinutesPerHour: number;
}

export interface FanRuntimeConfiguration {
  enabled: boolean;
  targetMinutesPerHour: number;
  minBlockMinutes: number;
}

export interface FanBlockRequest {
  durationMinutes: number;
  startsThisHour: number;
  targetMinutesPerHour: number;
  creditedMinutes: number;
  hourStartMs: number;
  nowMs: number;
  lastFanOnlyEndMs: number | null;
  timeZone?: string;
}

export interface FanBlockDecision {
  durationMinutes: number;
  reason: "deficit" | "minimum_overshoot";
}

export function fanRuntimeHourStartMs(
  timestampMs: number,
  timeZone: string,
): number {
  return moment.tz(timestampMs, timeZone).startOf("hour").valueOf();
}

function nextHourStartMs(hourMs: number, timeZone: string): number {
  return moment.tz(hourMs, timeZone).add(1, "hour").valueOf();
}

function overlapSeconds(
  startMs: number,
  endMs: number,
  intervalStartMs: number,
  intervalEndMs: number,
): number {
  const start = Math.max(startMs, intervalStartMs);
  const end = Math.min(endMs, intervalEndMs);
  return end > start ? (end - start) / 1000 : 0;
}

function mergeIntervals(intervals: RuntimeInterval[]): RuntimeInterval[] {
  const sorted = intervals
    .filter((interval) => interval.endMs > interval.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const merged: RuntimeInterval[] = [];
  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startMs <= previous.endMs) {
      previous.endMs = Math.max(previous.endMs, interval.endMs);
      continue;
    }
    merged.push({ ...interval });
  }
  return merged;
}

function runtimeSecondsForKind(
  intervals: RuntimeInterval[],
  kind: FanRuntimeKind,
  bucketHour: number,
  timeZone: string,
): number {
  const bucketEnd = nextHourStartMs(bucketHour, timeZone);
  return mergeIntervals(
    intervals.filter((interval) => interval.kind === kind),
  ).reduce(
    (sum, interval) =>
      sum +
      overlapSeconds(bucketHour, bucketEnd, interval.startMs, interval.endMs),
    0,
  );
}

/**
 * Credits observed equipment runtime into local wall-clock hour buckets.
 * Overlapping heat/cool and fan-only observations are counted once in the
 * total, while their individual categories remain available for reporting.
 */
export function bucketRuntimeByHour(
  intervals: RuntimeInterval[],
  timeZone = "UTC",
): HourlyRuntime[] {
  const validIntervals = intervals.filter(
    (interval) => interval.endMs > interval.startMs,
  );
  if (validIntervals.length === 0) return [];

  const firstHour = fanRuntimeHourStartMs(
    Math.min(...validIntervals.map((interval) => interval.startMs)),
    timeZone,
  );
  const lastHour = fanRuntimeHourStartMs(
    Math.max(...validIntervals.map((interval) => interval.endMs - 1)),
    timeZone,
  );
  const buckets = new Map<number, HourlyRuntime>();

  for (
    let currentHour = firstHour;
    currentHour <= lastHour;
    currentHour = nextHourStartMs(currentHour, timeZone)
  ) {
    buckets.set(currentHour, {
      hourStartMs: currentHour,
      heatCoolSeconds: 0,
      fanOnlySeconds: 0,
      creditedSeconds: 0,
    });
  }

  for (const [bucketHour, bucket] of buckets) {
    bucket.heatCoolSeconds = runtimeSecondsForKind(
      validIntervals,
      "heat_cool",
      bucketHour,
      timeZone,
    );
    bucket.fanOnlySeconds = runtimeSecondsForKind(
      validIntervals,
      "fan_only",
      bucketHour,
      timeZone,
    );
  }

  const mergedAll = mergeIntervals(validIntervals);
  for (const bucket of buckets.values()) {
    bucket.creditedSeconds = mergedAll.reduce(
      (sum, interval) =>
        sum +
        overlapSeconds(
          bucket.hourStartMs,
          nextHourStartMs(bucket.hourStartMs, timeZone),
          interval.startMs,
          interval.endMs,
        ),
      0,
    );
  }
  return [...buckets.values()];
}

export function isFanRuntimeConfigurationValid(
  configuration: FanRuntimeConfiguration,
  policy: FanBlockPolicy,
): boolean {
  if (!configuration.enabled) return true;
  if (!Number.isInteger(configuration.targetMinutesPerHour)) return false;
  if (!Number.isInteger(configuration.minBlockMinutes)) return false;
  if (configuration.minBlockMinutes < policy.minBlockMinutes) return false;
  if (configuration.minBlockMinutes > policy.maxBlockMinutes) return false;
  if (configuration.targetMinutesPerHour < configuration.minBlockMinutes) {
    return false;
  }
  if (configuration.targetMinutesPerHour > policy.maxTargetMinutesPerHour) {
    return false;
  }
  return isTargetFeasible(configuration.targetMinutesPerHour, {
    ...policy,
    minBlockMinutes: configuration.minBlockMinutes,
  });
}

export function feasibleTargetMinutes(
  configuration: Pick<FanRuntimeConfiguration, "minBlockMinutes">,
  policy: FanBlockPolicy,
): number[] {
  const values: number[] = [];
  for (let target = 5; target <= policy.maxTargetMinutesPerHour; target += 5) {
    if (
      target >= configuration.minBlockMinutes &&
      isTargetFeasible(target, {
        ...policy,
        minBlockMinutes: configuration.minBlockMinutes,
      })
    ) {
      values.push(target);
    }
  }
  return values;
}

function isTargetFeasible(
  targetMinutes: number,
  policy: FanBlockPolicy,
): boolean {
  if (targetMinutes <= 0) return true;
  for (let starts = 1; starts <= policy.maxStartsPerHour; starts += 1) {
    const minimumRuntime = starts * policy.minBlockMinutes;
    const maximumRuntime = starts * policy.maxBlockMinutes;
    const requiredWindow =
      targetMinutes + Math.max(0, starts - 1) * policy.minGapMinutes;
    if (
      targetMinutes >= minimumRuntime &&
      targetMinutes <= maximumRuntime &&
      requiredWindow <= 60
    ) {
      return true;
    }
  }
  return false;
}

export function selectNextFanBlock(
  request: FanBlockRequest,
  policy: FanBlockPolicy,
): FanBlockDecision | null {
  const deficitMinutes = request.targetMinutesPerHour - request.creditedMinutes;
  if (deficitMinutes <= 0) return null;
  if (request.startsThisHour >= policy.maxStartsPerHour) return null;

  const hourEndMs = nextHourStartMs(
    request.hourStartMs,
    request.timeZone ?? "UTC",
  );
  const remainingMs = hourEndMs - request.nowMs;
  const minimumMs = policy.minBlockMinutes * 60 * 1000;
  if (remainingMs < minimumMs) return null;

  if (
    request.lastFanOnlyEndMs !== null &&
    request.nowMs - request.lastFanOnlyEndMs < policy.minGapMinutes * 60 * 1000
  ) {
    return null;
  }

  const availableMinutes = Math.floor(remainingMs / 60_000);
  const durationMinutes = Math.min(
    policy.maxBlockMinutes,
    Math.max(policy.minBlockMinutes, deficitMinutes),
    availableMinutes,
  );
  if (durationMinutes < policy.minBlockMinutes) return null;

  return {
    durationMinutes,
    reason: durationMinutes > deficitMinutes ? "minimum_overshoot" : "deficit",
  };
}
