import type { ScheduleEvent } from "~/client/api/schedulesApi";

// Pure color-assignment logic, split into its own non-component module —
// a component file exporting anything besides components breaks React
// Fast Refresh (react-refresh/only-export-components). Shared by
// ScheduleMatrix (one room's own week-strip) and ScheduleRoomsOverview
// (which computes this once across an entire schedule's events and hands
// the same map to every room, so two rooms sharing a period render the
// same color).

// A small, fixed rotating palette for distinguishing one event's blocks
// from another's — deliberately separate from statusPalette.ts's fixed
// satisfied/demanding/etc. vocabulary, since "which event is this" isn't
// a status.
export const EVENT_COLORS = [
  "#1976d2",
  "#2e7d32",
  "#7b1fa2",
  "#00838f",
  "#c2185b",
  "#5d4037",
  "#455a64",
  "#f57c00",
];

export function buildColorByEventId(
  events: ScheduleEvent[],
): Map<string, string> {
  return new Map(
    events.map((e, i) => [e.id, EVENT_COLORS[i % EVENT_COLORS.length]]),
  );
}
