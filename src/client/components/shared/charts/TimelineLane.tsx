import Box from "@mui/material/Box";
import type { TimelineSegment } from "~/client/components/shared/charts/timelineSegments";

interface TimelineLaneProps {
  domain: [number, number];
  segments: TimelineSegment[];
  height?: number;
}

/**
 * A single colored horizontal lane spanning `domain`, with each segment
 * positioned by its own proportional share of the range — not a Recharts
 * chart, since a categorical "which state held over this stretch" view has
 * no numeric axis to plot. Shared by HvacStateTimeline and
 * SpikeEventTimeline rather than each reimplementing the same absolute-
 * positioning math.
 */
export default function TimelineLane({
  domain,
  segments,
  height = 28,
}: TimelineLaneProps) {
  const [from, to] = domain;
  const span = Math.max(to - from, 1);
  return (
    <Box
      sx={{
        position: "relative",
        height,
        width: "100%",
        bgcolor: "action.hover",
        borderRadius: 0.5,
        overflow: "hidden",
      }}
    >
      {segments.map((s, i) => {
        const clampedStart = Math.max(s.startMs, from);
        const clampedEnd = Math.min(s.endMs, to);
        const widthPct = ((clampedEnd - clampedStart) / span) * 100;
        if (widthPct <= 0) return null;
        const leftPct = ((clampedStart - from) / span) * 100;
        return (
          <Box
            key={`${s.startMs}-${i}`}
            title={s.label}
            // Plain `style`, not `sx` — these are per-instance computed
            // percentages with no theme dependency, and could number in the
            // hundreds for a wide window, so this avoids emotion generating
            // a distinct class per unique percentage value.
            style={{
              position: "absolute",
              left: `${leftPct}%`,
              width: `${widthPct}%`,
              top: 0,
              bottom: 0,
              backgroundColor: s.color,
            }}
          />
        );
      })}
    </Box>
  );
}
