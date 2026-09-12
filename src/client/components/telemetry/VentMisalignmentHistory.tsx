import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";
import DiagnosticTile from "~/client/components/diagnostics/DiagnosticTile";
import { formatChartDateTime } from "~/client/components/shared/charts/chartTime";
import { computeVentMisalignmentPeriodsForZone } from "~/client/components/telemetry/chartData";
import SectionHeading from "~/client/components/shared/SectionHeading";

const VENT_MISALIGNMENT_DESCRIPTION =
  'A satisfied zone whose vent reported fully closed kept tracking the active call anyway — percent-open is an accumulated motor estimate, not a true position sensor, so the vent\'s real position had drifted from what it reported. Each period below is one auto-recalibration cycle (vent forced open, then let back down) — a common, self-correcting situation, not something that needs action. Deeper detail (exact temp drift, how long the open took) is in Loki under "Vent misalignment".';

interface VentMisalignmentHistoryProps {
  points: TickHistoryPoint[];
  zoneId: string;
}

/**
 * "Quick view" per-zone history for the vent-misalignment auto-
 * recalibration feature (see vent_misalignment_auto_recalibration_enabled's
 * own comment, systemSettings.ts) — one tile per completed/abandoned
 * recalibration cycle within whatever window `points` covers, mirroring
 * DegradedVentHistory's own period-tile pattern. The tile count alone
 * answers "how often is this happening to this zone" at a glance; this
 * intentionally doesn't distinguish "opened" from "timed_out" outcomes or
 * show the underlying temp drift — that's what the structured Loki events
 * are for, not this glance view.
 */
export default function VentMisalignmentHistory({
  points,
  zoneId,
}: VentMisalignmentHistoryProps) {
  if (points.length === 0) {
    return null;
  }

  const domainEndMs = points[points.length - 1].loggedAtMs;
  const periods = computeVentMisalignmentPeriodsForZone(
    points,
    zoneId,
    domainEndMs,
  );

  return (
    <Box>
      <SectionHeading
        title="Vent Misalignment (this window)"
        description={VENT_MISALIGNMENT_DESCRIPTION}
        variant="caption"
        sx={{ mb: 1 }}
      />
      {periods.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No suspected misalignment in this window.
        </Typography>
      ) : (
        <Stack direction="row" flexWrap="wrap" gap={1.5}>
          {periods.map((p, i) => {
            const endedAgoMs = domainEndMs - p.endMs;
            return (
              <DiagnosticTile
                key={i}
                label="Suspected misalignment"
                value={`${Math.round((p.endMs - p.startMs) / 60_000)}m`}
                caption={
                  endedAgoMs <= 0
                    ? "ongoing"
                    : `ended ${formatChartDateTime(p.endMs)}`
                }
                status="warning"
              />
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
