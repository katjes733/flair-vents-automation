import { maskIncludesDay } from "~/server/domain/schedule/dayMask";

function toMinutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * The whole DST trick, per "Scheduling Engine": never compute a UTC instant
 * for a recurring wall-clock time — convert `nowMs` into local calendar
 * parts via the configured IANA home timezone and compare entirely in the
 * local domain. This is automatically correct across both transitions with
 * no special-casing, since Intl always resolves a real instant to whatever
 * wall-clock genuinely exists at that moment in that zone.
 */
function getLocalParts(
  nowMs: number,
  timezone: string,
): { dayOfWeek: number; minutesOfDay: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  // Intl.DateTimeFormat always includes weekday/hour/minute parts for these
  // options — no fallback branch needed for a case that can't occur.
  const parts = formatter.formatToParts(new Date(nowMs));
  const weekday = parts.find((p) => p.type === "weekday")!.value;
  const hour = Number(parts.find((p) => p.type === "hour")!.value);
  const minute = Number(parts.find((p) => p.type === "minute")!.value);
  return {
    dayOfWeek: WEEKDAY_INDEX[weekday],
    minutesOfDay: hour * 60 + minute,
  };
}

/**
 * Whether a schedule event's window is active at `nowMs`, in the given
 * home timezone. Wraparound windows (e.g. 20:30–07:00) use days_of_week =
 * the day the window *starts*, per the Scheduling Engine section.
 */
export function isEventActiveAt(
  event: { start_time: string; end_time: string; days_of_week: number },
  nowMs: number,
  timezone: string,
): boolean {
  const { dayOfWeek, minutesOfDay } = getLocalParts(nowMs, timezone);
  const start = toMinutesOfDay(event.start_time);
  const end = toMinutesOfDay(event.end_time);

  if (start < end) {
    return (
      maskIncludesDay(event.days_of_week, dayOfWeek) &&
      minutesOfDay >= start &&
      minutesOfDay < end
    );
  }

  // Wraparound: active from start-to-midnight on the start day, or
  // midnight-to-end on the day after.
  const startDayActive =
    maskIncludesDay(event.days_of_week, dayOfWeek) && minutesOfDay >= start;
  const previousDay = (dayOfWeek + 6) % 7;
  const tailActive =
    maskIncludesDay(event.days_of_week, previousDay) && minutesOfDay < end;
  return startDayActive || tailActive;
}
