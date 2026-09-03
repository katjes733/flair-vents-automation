import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type { Zone } from "~/client/api/zonesApi";
import type { AirHandlerTickDecision } from "~/client/api/airHandlersApi";
import DiagnosticTile from "~/client/components/diagnostics/DiagnosticTile";
import { formatElapsed } from "~/client/components/diagnostics/formatElapsed";

interface DegradedVentHistoryProps {
  zones: Zone[];
  tickDecisionsByAirHandlerId: Map<string, AirHandlerTickDecision | null>;
  nowMs?: number;
}

/**
 * **Current-status only** — who's degraded right now, and since when.
 * Named for its eventual Increment-B form (a scrollable timeline of past
 * degraded periods, sourced from Loki's `Vent degraded`/`Vent reconciled`
 * log lines) — this increment builds only the "what's true right now"
 * half, using the same component name so that follow-up extends this file
 * rather than replacing it. See "Stage 12 — Current-Status Diagnostics".
 */
export default function DegradedVentHistory({
  zones,
  tickDecisionsByAirHandlerId,
  nowMs = Date.now(),
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

  return (
    <Box>
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
    </Box>
  );
}
