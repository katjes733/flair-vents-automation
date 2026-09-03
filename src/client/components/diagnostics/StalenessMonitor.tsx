import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type { Zone } from "~/client/api/zonesApi";
import DiagnosticTile from "~/client/components/diagnostics/DiagnosticTile";
import { formatElapsed } from "~/client/components/diagnostics/formatElapsed";

interface StalenessMonitorProps {
  zones: Zone[];
  nowMs?: number;
}

/**
 * Per-zone reading-freshness leading indicator — the in-app view of the
 * same signal the Grafana "time-since-last-update" panel would show,
 * sourced entirely from `Zone.state` (already returned by the existing
 * `GET /zones`, no new plumbing). See "Stage 12 — Current-Status
 * Diagnostics". Every zone gets a tile, including one with no reading yet
 * — that's informative on its own, not an error state to hide.
 */
export default function StalenessMonitor({
  zones,
  nowMs = Date.now(),
}: StalenessMonitorProps) {
  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        Sensor Reading Freshness
      </Typography>
      <Stack direction="row" flexWrap="wrap" gap={1.5}>
        {zones.map((zone) => {
          const changedAt = zone.state.last_reading_changed_at;
          const status = zone.state.stale
            ? "error"
            : changedAt
              ? "success"
              : "default";
          return (
            <DiagnosticTile
              key={zone.id}
              label={zone.name}
              value={
                zone.state.stale
                  ? "Stale"
                  : changedAt
                    ? "Fresh"
                    : "No reading yet"
              }
              caption={changedAt ? formatElapsed(changedAt, nowMs) : undefined}
              status={status}
            />
          );
        })}
      </Stack>
    </Box>
  );
}
