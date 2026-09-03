import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type { Zone } from "~/client/api/zonesApi";
import type { AirHandlerTickDecision } from "~/client/api/airHandlersApi";
import DiagnosticTile from "~/client/components/diagnostics/DiagnosticTile";

interface HardwareDiagnosticsProps {
  zones: Zone[];
  tickDecisionsByAirHandlerId: Map<string, AirHandlerTickDecision | null>;
}

// Below this, a vent's own battery is worth flagging — Flair's smart vents
// report voltage in the 2.0-3.3V range for their 2xAA supply; this is a
// display-only heuristic (no equivalent server-side threshold/alert exists
// yet), not a value the domain layer depends on.
const LOW_VOLTAGE_THRESHOLD = 2.5;

/**
 * Per-vent battery voltage + RSSI — sourced from the tick-decision record,
 * since that's the only place these fields are threaded (Flair's own
 * `vents` payload already carries them every tick; they were simply
 * dropped at ingestion until "Stage 12 — Current-Status Diagnostics").
 * Only smart-vent zones contribute tiles — manual/no_vent zones have no
 * Flair vent to report on.
 */
export default function HardwareDiagnostics({
  zones,
  tickDecisionsByAirHandlerId,
}: HardwareDiagnosticsProps) {
  const tiles = zones.flatMap((zone) => {
    const decision = tickDecisionsByAirHandlerId.get(zone.airHandlerId);
    const zoneDecision = decision?.zones.find((z) => z.zone_id === zone.id);
    return zone.config.flair_vents.map(({ flair_vent_id }, index) => {
      const vent = zoneDecision?.vents.find(
        (v) => v.flair_vent_id === flair_vent_id,
      );
      const label = `${zone.name} — ${vent?.name || `Vent ${index + 1}`}`;
      const lowBattery =
        vent?.voltage !== null &&
        vent?.voltage !== undefined &&
        vent.voltage < LOW_VOLTAGE_THRESHOLD;
      return {
        key: `${zone.id}:${flair_vent_id}`,
        label,
        voltage: vent?.voltage ?? null,
        rssi: vent?.current_rssi ?? null,
        lowBattery,
      };
    });
  });

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        Vent Hardware
      </Typography>
      {tiles.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No smart vents configured yet.
        </Typography>
      ) : (
        <Stack direction="row" flexWrap="wrap" gap={1.5}>
          {tiles.map((tile) => (
            <DiagnosticTile
              key={tile.key}
              label={tile.label}
              value={
                tile.voltage !== null ? `${tile.voltage.toFixed(2)} V` : "—"
              }
              caption={
                tile.rssi !== null ? `RSSI ${tile.rssi} dBm` : "No reading yet"
              }
              status={
                tile.voltage === null
                  ? "default"
                  : tile.lowBattery
                    ? "warning"
                    : "success"
              }
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}
