import { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import TimelineLane from "~/client/components/shared/charts/TimelineLane";
import { computeOverrideSegments } from "~/client/components/telemetry/chartData";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import { asAbsoluteTemp, toDisplayAbsolute } from "~/shared/types/temperature";
import type { ManualOverrideRecord } from "~/client/api/overridesApi";

interface OverrideActivityLaneProps {
  overrides: ManualOverrideRecord[];
  domain: [number, number];
  height?: number;
}

/**
 * When a manual override was active for this zone over the window — the
 * activity lane deferred from Stage 13, Increment B (it needed a real
 * override-history endpoint the API didn't have yet; see
 * `GET /overrides/:zoneId/history`). Every segment uses the same
 * `theme.palette.status.manualOverride` token ZoneCard's own "Manual
 * override" chip uses, so the color means the same thing everywhere in
 * this app.
 */
export default function OverrideActivityLane({
  overrides,
  domain,
  height = 20,
}: OverrideActivityLaneProps) {
  const theme = useTheme();
  const { temperatureUnit } = useDisplayUnit();

  const segments = useMemo(() => {
    return computeOverrideSegments(overrides, domain[1]).map((s) => {
      const { config } = s.override;
      const valueLabel =
        config.kind === "setpoint"
          ? `${toDisplayAbsolute(asAbsoluteTemp(config.value), temperatureUnit).toFixed(1)}°${temperatureUnit}`
          : `${config.value}%`;
      const status = s.override.revokedAtMs !== null ? ", revoked" : "";
      return {
        startMs: s.startMs,
        endMs: s.endMs,
        color: theme.palette.status.manualOverride,
        label: `${config.actor}: ${config.kind} ${valueLabel} (${config.hold_type}${status})`,
      };
    });
  }, [overrides, domain, theme, temperatureUnit]);

  return (
    <Box>
      <Typography variant="caption" color="text.secondary">
        Manual Override Activity
      </Typography>
      <TimelineLane domain={domain} segments={segments} height={height} />
      {overrides.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          No overrides in this window.
        </Typography>
      )}
    </Box>
  );
}
