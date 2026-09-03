/**
 * Normalizes a raw, possibly-partial/stale priority order (as stored —
 * `system_settings.config.zone_priority_order` or a schedule event's own
 * override) against the current, real set of zone ids: known ids keep
 * their relative order (deduplicated), a stale id no longer among
 * `zoneIds` is dropped, and any zone not yet present in `value` is
 * appended at the end in `zoneIds`' own order. A priority list only means
 * anything relative to the other zones it's ranked against, so the
 * component built against this always shows every zone, never a subset a
 * caller has to keep in sync by hand.
 */
export function normalizeZonePriorityOrder(
  value: string[],
  zoneIds: string[],
): string[] {
  const known = new Set(zoneIds);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of value) {
    if (known.has(id) && !seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  for (const id of zoneIds) {
    if (!seen.has(id)) {
      result.push(id);
      seen.add(id);
    }
  }
  return result;
}
