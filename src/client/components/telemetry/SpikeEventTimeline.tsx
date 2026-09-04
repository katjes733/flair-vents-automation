import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import TimelineLane from "~/client/components/shared/charts/TimelineLane";
import { buildStepSegments } from "~/client/components/shared/charts/timelineSegments";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";

interface SpikeEventTimelineProps {
  points: TickHistoryPoint[];
  zoneId: string;
  height?: number;
}

/** When a zone's dynamic thermal spike detection was active over the
 * window — see "Dynamic thermal spike detection" and "Stage 13,
 * Increment B". Tick-granularity, not immediate event edges — coarser
 * than the `Thermal spike detected`/`decayed` log events themselves, but
 * built from the same already-fetched tick-history query as every other
 * chart on this page rather than a second, narrower one. */
export default function SpikeEventTimeline({
  points,
  zoneId,
  height = 20,
}: SpikeEventTimelineProps) {
  const theme = useTheme();

  const domain = useMemo((): [number, number] => {
    if (points.length === 0) return [0, 1];
    return [points[0].loggedAtMs, points[points.length - 1].loggedAtMs];
  }, [points]);

  const segments = useMemo(() => {
    if (points.length === 0) return [];
    const samples = points.map((p) => {
      const zone = p.decision.zones.find((z) => z.zone_id === zoneId);
      return { timeMs: p.loggedAtMs, value: zone?.spiking ?? false };
    });
    return buildStepSegments(
      samples,
      domain[1],
      (spiking) => (spiking ? theme.palette.status.spiking : "transparent"),
      (spiking) => (spiking ? "Spiking" : "Normal"),
    );
  }, [points, zoneId, domain, theme]);

  if (points.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No data in this window yet.
      </Typography>
    );
  }

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        Spike Detection
      </Typography>
      <TimelineLane domain={domain} segments={segments} height={height} />
    </Box>
  );
}
