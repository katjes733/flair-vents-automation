import { useRef, useState, type MouseEvent } from "react";
import Box from "@mui/material/Box";
import type { TimelineSegment } from "~/client/components/shared/charts/timelineSegments";
import ChartTooltip from "~/client/components/shared/charts/ChartTooltip";

interface TimelineLaneProps {
  domain: [number, number];
  segments: TimelineSegment[];
  height?: number;
}

interface HoverState {
  xPct: number; // 0-100, where to anchor the floating tooltip
  timeMs: number;
  segment: TimelineSegment;
}

/**
 * A single colored horizontal lane spanning `domain`, with each segment
 * positioned by its own proportional share of the range — not a Recharts
 * chart, since a categorical "which state held over this stretch" view has
 * no numeric axis to plot. Shared by HvacStateTimeline and
 * SpikeEventTimeline rather than each reimplementing the same absolute-
 * positioning math.
 *
 * Hovering tracks the cursor's horizontal position, maps it back to a real
 * timestamp within `domain`, finds which segment that time falls in, and
 * shows a floating tooltip in the same `ChartTooltip` shape every
 * Recharts-based graph on this page already uses — so this categorical
 * lane and the numeric charts around it behave consistently, rather than
 * falling back to a plain native browser tooltip.
 */
export default function TimelineLane({
  domain,
  segments,
  height = 28,
}: TimelineLaneProps) {
  const [from, to] = domain;
  const span = Math.max(to - from, 1);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const xPct = Math.min(
      100,
      Math.max(0, ((e.clientX - rect.left) / rect.width) * 100),
    );
    const timeMs = from + (xPct / 100) * span;
    const segment = segments.find(
      (s) => timeMs >= s.startMs && timeMs < s.endMs,
    );
    if (!segment) {
      setHover(null);
      return;
    }
    setHover({ xPct, timeMs, segment });
  };

  return (
    <Box sx={{ position: "relative" }}>
      <Box
        ref={containerRef}
        data-testid="timeline-lane"
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
        sx={{
          position: "relative",
          height,
          width: "100%",
          bgcolor: "action.hover",
          borderRadius: 0.5,
          overflow: "hidden",
          cursor: segments.length > 0 ? "crosshair" : undefined,
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
              data-testid="timeline-segment"
              data-label={s.label}
              // Plain `style`, not `sx` — these are per-instance computed
              // percentages with no theme dependency, and could number in
              // the hundreds for a wide window, so this avoids emotion
              // generating a distinct class per unique percentage value.
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
      {hover && (
        <Box
          sx={{
            position: "absolute",
            top: "100%",
            mt: 0.5,
            left: `${hover.xPct}%`,
            transform:
              hover.xPct > 85
                ? "translateX(-100%)"
                : hover.xPct < 15
                  ? "translateX(0%)"
                  : "translateX(-50%)",
            pointerEvents: "none",
            zIndex: 1,
          }}
        >
          <ChartTooltip
            timeMs={hover.timeMs}
            rows={[
              {
                label: "State",
                value: hover.segment.label,
                color: hover.segment.color,
              },
            ]}
          />
        </Box>
      )}
    </Box>
  );
}
