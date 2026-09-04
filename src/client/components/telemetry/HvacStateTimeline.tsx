import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import { useTheme, type Theme } from "@mui/material/styles";
import TimelineLane from "~/client/components/shared/charts/TimelineLane";
import { buildStepSegments } from "~/client/components/shared/charts/timelineSegments";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";

interface HvacStateTimelineProps {
  points: TickHistoryPoint[];
  height?: number;
}

const STATE_LABELS: Record<string, string> = {
  COOLING_CALL: "Cooling",
  HEATING_CALL: "Heating",
  FAN_ONLY: "Fan only",
  IDLE: "Idle",
};

function colorForState(state: string, theme: Theme): string {
  switch (state) {
    case "COOLING_CALL":
      return theme.palette.info.main;
    case "HEATING_CALL":
      return theme.palette.warning.main;
    case "FAN_ONLY":
      return theme.palette.text.disabled;
    case "IDLE":
      return theme.palette.success.main;
    default:
      return theme.palette.text.disabled;
  }
}

/** Which HVAC call state held over each stretch of the window — see
 * "Stage 13, Increment B". */
export default function HvacStateTimeline({
  points,
  height = 28,
}: HvacStateTimelineProps) {
  const theme = useTheme();

  const domain = useMemo((): [number, number] => {
    if (points.length === 0) return [0, 1];
    return [points[0].loggedAtMs, points[points.length - 1].loggedAtMs];
  }, [points]);

  const segments = useMemo(() => {
    if (points.length === 0) return [];
    const samples = points.map((p) => ({
      timeMs: p.loggedAtMs,
      value: p.decision.hvac_state,
    }));
    return buildStepSegments(
      samples,
      domain[1],
      (state) => colorForState(state, theme),
      (state) => STATE_LABELS[state] ?? state,
    );
  }, [points, domain, theme]);

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
        HVAC State
      </Typography>
      <TimelineLane domain={domain} segments={segments} height={height} />
      <Stack direction="row" spacing={2} sx={{ mt: 0.5, flexWrap: "wrap" }}>
        {Object.entries(STATE_LABELS).map(([state, label]) => (
          <Stack key={state} direction="row" alignItems="center" spacing={0.5}>
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: colorForState(state, theme),
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
