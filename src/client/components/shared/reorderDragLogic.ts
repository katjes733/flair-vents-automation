// Pure drag/reorder arithmetic, shared by every reorderable list in this
// app (ZoneGrid's dashboard cards, ZonePriorityList's zone priority order)
// — split into its own non-component module since a component file
// exporting anything besides components breaks React Fast Refresh
// (react-refresh/only-export-components). Also lets this be unit-tested
// directly with plain numbers: jsdom's `DragEvent`/pointer-position support
// is incomplete enough that simulating real drag gestures to exercise this
// logic indirectly is unreliable, independent of whether the logic itself
// is correct. Domain-agnostic on purpose — every caller supplies its own
// array and its own drag handlers; this file only ever does index math.

export interface DropTarget {
  index: number;
  side: "before" | "after";
}

export function computeDropSide(
  clientX: number,
  rect: { left: number; width: number },
): "before" | "after" {
  return clientX - rect.left < rect.width / 2 ? "before" : "after";
}

/**
 * Where `fromIndex` should land in the array once removed and reinserted
 * relative to `target` — `null` if that's a no-op (dropped back onto its
 * own original position, or immediately adjacent to it on the side that
 * doesn't actually move it).
 */
export function computeReorderedIndex(
  fromIndex: number,
  target: DropTarget,
): number | null {
  if (target.index === fromIndex) return null;
  let insertAt = target.index + (target.side === "after" ? 1 : 0);
  if (fromIndex < target.index) insertAt -= 1;
  if (insertAt === fromIndex) return null;
  return insertAt;
}
