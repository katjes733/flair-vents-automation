import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type { Zone } from "~/client/api/zonesApi";
import type { AirHandlerTickDecision } from "~/client/api/airHandlersApi";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";
import DiagnosticTile from "~/client/components/diagnostics/DiagnosticTile";
import { formatElapsed } from "~/client/components/diagnostics/formatElapsed";
import {
  computeDegradedPeriodsForVent,
  findLatestVentName,
} from "~/client/components/telemetry/chartData";

interface DegradedVentHistoryProps {
  zones: Zone[];
  tickDecisionsByAirHandlerId: Map<string, AirHandlerTickDecision | null>;
  nowMs?: number;
  // Optional — only ever supplied by TelemetryPage, scoped to whichever one
  // air handler is currently selected there (Loki-backed history is
  // per-air-handler, see "Stage 13, Increment B"). DiagnosticsPage never
  // passes this, so its own render stays exactly the current-status view
  // it always was — this is an addition, not a behavior change.
  historyPoints?: TickHistoryPoint[];
  // TelemetryPage has no live-status cache to show a "currently degraded"
  // section honestly (it only ever fetches historical points) — set when
  // only the historical section below should render.
  hideCurrentStatus?: boolean;
}

/**
 * Current-status half: who's degraded right now, and since when — see
 * "Stage 12 — Current-Status Diagnostics". The optional `historyPoints`
 * prop adds the Increment-B historical half onto the SAME component
 * (rather than a new one), per that section's own "named for its eventual
 * Increment-B form" framing — a scrollable-enough list of past degraded
 * periods within whatever window `historyPoints` covers, not a live
 * timeline chart.
 */
export default function DegradedVentHistory({
  zones,
  tickDecisionsByAirHandlerId,
  nowMs = Date.now(),
  historyPoints,
  hideCurrentStatus = false,
}: DegradedVentHistoryProps) {
  const tiles = zones.flatMap((zone) =>
    zone.state.vents
      .filter((v) => v.degraded)
      .map((vent, index) => {
        const decision = tickDecisionsByAirHandlerId.get(zone.airHandlerId);
        const nickname = decision?.zones
          .find((z) => z.zone_id === zone.id)
          ?.vents.find((v) => v.flair_vent_id === vent.flair_vent_id)?.name;
        return {
          key: `${zone.id}:${vent.flair_vent_id}`,
          label: `${zone.name} — ${nickname || `Vent ${index + 1}`}`,
          since: vent.degraded_since,
        };
      }),
  );

  const historyTiles =
    historyPoints && historyPoints.length > 0
      ? zones.flatMap((zone) =>
          zone.config.flair_vents.flatMap((v, index) => {
            const periods = computeDegradedPeriodsForVent(
              historyPoints,
              zone.id,
              v.flair_vent_id,
              historyPoints[historyPoints.length - 1].loggedAtMs,
            );
            const nickname = findLatestVentName(
              historyPoints,
              zone.id,
              v.flair_vent_id,
            );
            const label = `${zone.name} — ${nickname || `Vent ${index + 1}`}`;
            return periods.map((p, i) => ({
              key: `${zone.id}:${v.flair_vent_id}:${i}`,
              label,
              durationMs: p.endMs - p.startMs,
              endedAgoMs:
                historyPoints[historyPoints.length - 1].loggedAtMs - p.endMs,
            }));
          }),
        )
      : [];

  return (
    <Box>
      {!hideCurrentStatus && (
        <>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Currently Degraded Vents
          </Typography>
          {tiles.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No vents are currently degraded.
            </Typography>
          ) : (
            <Stack direction="row" flexWrap="wrap" gap={1.5}>
              {tiles.map((tile) => (
                <DiagnosticTile
                  key={tile.key}
                  label={tile.label}
                  value="Degraded"
                  caption={
                    tile.since ? formatElapsed(tile.since, nowMs) : undefined
                  }
                  status="error"
                />
              ))}
            </Stack>
          )}
        </>
      )}

      {historyPoints && historyPoints.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Degraded Periods (this window)
          </Typography>
          {historyTiles.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No degraded periods in this window.
            </Typography>
          ) : (
            <Stack direction="row" flexWrap="wrap" gap={1.5}>
              {historyTiles.map((tile) => (
                <DiagnosticTile
                  key={tile.key}
                  label={tile.label}
                  value={`${Math.round(tile.durationMs / 60_000)}m`}
                  caption={
                    tile.endedAgoMs <= 0
                      ? "ongoing"
                      : `ended ${Math.round(tile.endedAgoMs / 60_000)}m ago`
                  }
                  status="warning"
                />
              ))}
            </Stack>
          )}
        </Box>
      )}
    </Box>
  );
}
