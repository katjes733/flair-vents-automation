import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";
import DiagnosticTile from "~/client/components/diagnostics/DiagnosticTile";
import { formatChartDateTime } from "~/client/components/shared/charts/chartTime";
import { computeHomeKitOutagePeriodsForAirHandler } from "~/client/components/telemetry/chartData";
import SectionHeading from "~/client/components/shared/SectionHeading";

const HOMEKIT_OUTAGE_DESCRIPTION =
  "Periods where this air handler's local HomeKit connection (used to read live thermostat state and push a corrective setpoint that ends a call early once every zone is satisfied) was failing. Vent control keeps working throughout — Flair's own cloud-relayed state is the automatic read fallback — but calls can run longer than they need to until this clears, since only HomeKit lets a call end early. See homekit_outage_alert_minutes in System Parameters for the alerting threshold.";

interface HomeKitOutageHistoryProps {
  points: TickHistoryPoint[];
}

/**
 * Air-handler-scoped "quick view" history for HomeKit connectivity — one
 * tile per continuous outage period within whatever window `points`
 * covers, mirroring VentMisalignmentHistory's own period-tile pattern.
 * Renders nothing for an air handler that has never used HomeKit delivery
 * at all in this window, same as a zone with no vents never rendering a
 * vent chart. Built after a real, confirmed 30+ hour outage (2026-09-12/13)
 * that had no visibility anywhere in the UI until Loki logs were manually
 * queried — see homekit_outage_alert_minutes' own comment,
 * systemSettings.ts, for the alerting half of that same fix.
 */
export default function HomeKitOutageHistory({
  points,
}: HomeKitOutageHistoryProps) {
  const usesHomeKit = points.some(
    (p) => p.decision.setpoint_push?.delivery_mode === "homekit",
  );
  if (points.length === 0 || !usesHomeKit) {
    return null;
  }

  const domainEndMs = points[points.length - 1].loggedAtMs;
  const periods = computeHomeKitOutagePeriodsForAirHandler(points, domainEndMs);

  return (
    <Box>
      <SectionHeading
        title="HomeKit Connectivity (this window)"
        description={HOMEKIT_OUTAGE_DESCRIPTION}
        variant="caption"
        sx={{ mb: 1 }}
      />
      {periods.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No HomeKit outages in this window.
        </Typography>
      ) : (
        <Stack direction="row" flexWrap="wrap" gap={1.5}>
          {periods.map((p, i) => {
            const endedAgoMs = domainEndMs - p.endMs;
            return (
              <DiagnosticTile
                key={i}
                label="HomeKit outage"
                value={`${Math.round((p.endMs - p.startMs) / 60_000)}m`}
                caption={
                  endedAgoMs <= 0
                    ? "ongoing"
                    : `ended ${formatChartDateTime(p.endMs)}`
                }
                status="error"
              />
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
