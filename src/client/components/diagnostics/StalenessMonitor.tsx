import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import type { Zone } from "~/client/api/zonesApi";
import DiagnosticTile from "~/client/components/diagnostics/DiagnosticTile";
import { formatElapsed } from "~/client/components/diagnostics/formatElapsed";
import SectionHeading from "~/client/components/shared/SectionHeading";

const STALENESS_DESCRIPTION =
  "Flags a zone whose sensor reading hasn't changed in over 15 minutes (by default) while it isn't already comfortably satisfied — a zone that's genuinely satisfied is expected to report an unchanging reading, so that case is never flagged. A stale zone is excluded from position control and rests at its idle baseline until real data resumes, which happens automatically, with no manual reset needed.";

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
      <SectionHeading
        title="Sensor Reading Freshness"
        description={STALENESS_DESCRIPTION}
        sx={{ mb: 1 }}
      />
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
