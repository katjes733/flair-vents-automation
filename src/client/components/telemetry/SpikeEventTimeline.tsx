import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import TimelineLane from "~/client/components/shared/charts/TimelineLane";
import { buildStepSegments } from "~/client/components/shared/charts/timelineSegments";
import SectionHeading from "~/client/components/shared/SectionHeading";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";

const SPIKE_DETECTION_DESCRIPTION =
  "Flags a RAPID temperature rise or fall — by default, a sustained rate of at least 0.5°C/min over a 12-minute window (both configurable in System Parameters). It targets a sudden anomaly (an appliance malfunction, a sync glitch), not ordinary gradual warming — a room slowly heating up over an hour is already handled by the normal comfort/demand logic instead, and won't trigger this on its own.";

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
      <SectionHeading
        title="Spike Detection"
        description={SPIKE_DETECTION_DESCRIPTION}
        variant="caption"
      />
      <TimelineLane domain={domain} segments={segments} height={height} />
    </Box>
  );
}
