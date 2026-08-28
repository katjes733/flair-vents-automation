// Bit 0 = Sunday ... bit 6 = Saturday, per the Data Model's days_of_week
// smallint bitmask and the Scheduling Engine section.

export function dayBit(dayOfWeek: number): number {
  return 1 << dayOfWeek;
}

export function maskIncludesDay(
  daysOfWeek: number,
  dayOfWeek: number,
): boolean {
  return (daysOfWeek & dayBit(dayOfWeek)) !== 0;
}

/** Used for the overlap tiebreak: fewer bits set = more specific. */
export function bitCount(daysOfWeek: number): number {
  let count = 0;
  let n = daysOfWeek;
  while (n > 0) {
    count += n & 1;
    n >>= 1;
  }
  return count;
}
