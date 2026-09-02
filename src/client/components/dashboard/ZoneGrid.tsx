import { useState } from "react";
import Grid from "@mui/material/Grid";
import Box from "@mui/material/Box";
import { updateZone, type Zone } from "~/client/api/zonesApi";
import type { ZoneTickDecisionRecord } from "~/client/api/airHandlersApi";
import type { ManualOverride } from "~/client/api/overridesApi";
import ZoneCard from "~/client/components/dashboard/ZoneCard";

interface ZoneGridProps {
  zones: Zone[];
  tickRecordsByZoneId: Map<string, ZoneTickDecisionRecord>;
  activeOverridesByZoneId: Map<string, ManualOverride>;
  onChanged: () => void;
  onEdit: (zone: Zone) => void;
}

export interface DropTarget {
  index: number;
  side: "before" | "after";
}

// Pure, exported so the arithmetic below can be unit-tested directly with
// plain numbers — jsdom's `DragEvent`/pointer-position support is
// incomplete enough that simulating real drag gestures to exercise this
// logic indirectly is unreliable, independent of whether the logic itself
// is correct.
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

function sortedByDisplayOrder(zones: Zone[]): Zone[] {
  // A plain, stable sort — ties (including the shared default of 0 for
  // every zone that's never been reordered) fall back to whatever order
  // the array already arrived in.
  return [...zones].sort(
    (a, b) => a.config.display_order - b.config.display_order,
  );
}

// A fingerprint of the server's own current ordering, used to decide
// whether to re-derive local drag state from a fresh `zones` prop — cheap
// insurance against the 15s poll refetch fighting an in-progress local
// reorder, without needing to diff the whole zone objects.
function orderKey(zones: Zone[]): string {
  return sortedByDisplayOrder(zones)
    .map((z) => z.id)
    .join(",");
}

/**
 * Drag-and-drop (desktop) and an always-available up/down arrow fallback
 * (touch, keyboard, or just a more precise single-position move) — both
 * call the same `persistOrder` function below, so the two interaction
 * paths can never diverge in behavior, matching the reorder-list
 * convention described for Phase 2's priority lists. The controls
 * themselves render inline in each `ZoneCard`'s own header (see its
 * `onMoveUp`/`onMoveDown` props) rather than a separate row here — the
 * whole point of this feature is more cards visible at once, not fewer.
 * Reorders within one air handler's zone list only, since ZoneGrid is
 * always scoped to a single handler's zones already. Persists via the
 * existing per-zone PATCH endpoint (`config.display_order`) — no new API
 * surface.
 */
export default function ZoneGrid({
  zones,
  tickRecordsByZoneId,
  activeOverridesByZoneId,
  onChanged,
  onEdit,
}: ZoneGridProps) {
  const [ordered, setOrdered] = useState(() => sortedByDisplayOrder(zones));
  // The `zones` prop's own key as of the last render we reacted to — NOT
  // the same thing as `ordered`'s own key. Comparing against the prop's
  // *previous* key (not against our own locally-mutated order) is what
  // lets us tell "the prop genuinely changed externally" apart from
  // "local is ahead, the prop just hasn't caught up to our own optimistic
  // reorder yet" — the latter must never trigger a reset back to the
  // now-stale prop order, which is exactly what comparing against our own
  // key did, undoing every reorder on the very next render before the
  // refetch had a chance to land.
  const [lastPropsKey, setLastPropsKey] = useState(() => orderKey(zones));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Which gap the dragged card would land in if dropped right now — a
  // thin indicator line renders at this position while dragging, per the
  // user's own request ("not evident when it will correctly lock in its
  // new position... an indicated line where the card would snap in").
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const currentPropsKey = orderKey(zones);
  if (currentPropsKey !== lastPropsKey) {
    setLastPropsKey(currentPropsKey);
    setOrdered(sortedByDisplayOrder(zones));
  }

  // `ordered` governs *position* only (deliberately not re-derived from
  // `zones` on every render — see orderKey's own comment, protecting an
  // in-flight drag/arrow reorder from a poll response that hasn't caught
  // up yet). It must not also be the source of each zone's *content* —
  // doing so meant any in-place field edit (renaming a zone, changing its
  // vent hardware type, a new sensor reading) was invisible until
  // something *else* happened to change the id ordering, since that's the
  // only thing that ever re-synced `ordered` from a fresh `zones` prop —
  // a real, user-reported bug ("changes don't refresh immediately").
  // Fresh content, by id, is looked up here on every render regardless.
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  function persistOrder(next: Zone[]): void {
    setOrdered(next);
    next.forEach((zone, index) => {
      if (zone.config.display_order === index) return;
      updateZone(zone.id, { config: { display_order: index } }).catch(() => {
        // Not worth a blocking error over — the next refresh reconciles
        // to whatever the server actually ended up with.
      });
    });
    onChanged();
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    persistOrder(next);
  }

  function endDrag(): void {
    setDraggingId(null);
    setDropTarget(null);
  }

  // Which half of the hovered card the pointer is over decides whether
  // the dragged card would land before or after it — the cards lay out
  // left-to-right, wrapping across rows, so "before"/"after" (rather
  // than a fixed top/bottom split) is what matches how they'll actually
  // move regardless of which column the target is in.
  function handleDragOver(
    e: React.DragEvent<HTMLDivElement>,
    index: number,
  ): void {
    e.preventDefault();
    const side = computeDropSide(
      e.clientX,
      e.currentTarget.getBoundingClientRect(),
    );
    setDropTarget((prev) =>
      prev?.index === index && prev.side === side ? prev : { index, side },
    );
  }

  function handleDrop(): void {
    const target = dropTarget;
    const fromIndex = ordered.findIndex((z) => z.id === draggingId);
    endDrag();
    if (!target || fromIndex === -1) return;
    const insertAt = computeReorderedIndex(fromIndex, target);
    if (insertAt === null) return; // dropped back where it started
    const next = [...ordered];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(insertAt, 0, moved);
    persistOrder(next);
  }

  return (
    <Grid container spacing={2}>
      {ordered.map((orderedZone, index) => {
        // Fall back to the ordered entry only in the single-render gap
        // right after a zone is deleted elsewhere and before `zones`'
        // changed id set has propagated back down to reset `ordered` —
        // never actually stale otherwise, since every id in `ordered`
        // came from a real `zones` prop to begin with.
        const zone = zonesById.get(orderedZone.id) ?? orderedZone;
        return (
          <Grid
            key={zone.id}
            size={{ xs: 12, sm: 6, md: 4 }}
            draggable
            onDragStart={() => setDraggingId(zone.id)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={handleDrop}
            onDragEnd={endDrag}
            sx={{
              position: "relative",
              opacity: draggingId === zone.id ? 0.5 : 1,
            }}
          >
            {draggingId &&
              draggingId !== zone.id &&
              dropTarget?.index === index && (
                <Box
                  aria-hidden
                  data-testid="drop-indicator"
                  sx={{
                    position: "absolute",
                    top: 4,
                    bottom: 4,
                    ...(dropTarget.side === "before"
                      ? { left: -5 }
                      : { right: -5 }),
                    width: 3,
                    borderRadius: 1,
                    bgcolor: "primary.main",
                    zIndex: 1,
                  }}
                />
              )}
            <ZoneCard
              zone={zone}
              tickRecord={tickRecordsByZoneId.get(zone.id)}
              activeOverride={activeOverridesByZoneId.get(zone.id)}
              onChanged={onChanged}
              onEdit={onEdit}
              onMoveUp={() => move(index, -1)}
              onMoveDown={() => move(index, 1)}
              canMoveUp={index > 0}
              canMoveDown={index < ordered.length - 1}
            />
          </Grid>
        );
      })}
    </Grid>
  );
}
