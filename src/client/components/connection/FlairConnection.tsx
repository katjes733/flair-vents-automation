import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableRow from "@mui/material/TableRow";
import type { FlairStatus } from "~/client/api/controlApi";
import DiagnosticTile from "~/client/components/diagnostics/DiagnosticTile";
import { formatElapsed } from "~/client/components/diagnostics/formatElapsed";

interface FlairConnectionProps {
  flairStatus: FlairStatus | null;
  nowMs?: number;
}

// Sourced directly from docs/flair-api-schema.md's own Phase 0 findings —
// never fabricated. Update this table only alongside a new confirmed
// finding in that doc, with the same citation discipline.
const CAPABILITY_MATRIX: Array<{ capability: string; status: string }> = [
  {
    capability: "Grant mode",
    status: "client_credentials — confirmed sufficient",
  },
  {
    capability: "Equipment fault field",
    status:
      "Not present — this app derives a signal from the duct-temperature differential instead",
  },
  { capability: "Battery voltage / RSSI on vents", status: "Present" },
  {
    capability: 'Per-reading "last updated" timestamp',
    status: "Present (created-at, distinct from the resource's own updated-at)",
  },
  {
    capability: "Comfort-setting sensor-group writability",
    status:
      "Not tested — this app's setpoint-push design doesn't depend on the answer",
  },
  {
    capability: "Home/Away scope (per-zone vs. structure-wide)",
    status: "Unconfirmed — untestable with only one active zone so far",
  },
  { capability: "Force-fresh-read parameter", status: "Not found" },
  {
    capability: "authorization_code / refresh_token grant modes",
    status: "Not tested (client_credentials already confirmed sufficient)",
  },
];

/**
 * Live Flair connection health (outage state, token-refresh failures, the
 * daily token-call budget) plus a static capability matrix documenting
 * what Phase 0 discovery actually confirmed — see "Stage 12 —
 * Current-Status Diagnostics" and `docs/flair-api-schema.md`.
 */
export default function FlairConnection({
  flairStatus,
  nowMs = Date.now(),
}: FlairConnectionProps) {
  const budgetPct = flairStatus
    ? Math.round(
        (flairStatus.tokenCallsToday / flairStatus.tokenDailyBudget) * 100,
      )
    : 0;

  return (
    <Box>
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
        Flair Connection
      </Typography>
      {!flairStatus ? (
        <Typography variant="body2" color="text.secondary">
          Connection status unavailable.
        </Typography>
      ) : (
        <Stack direction="row" flexWrap="wrap" gap={1.5} sx={{ mb: 2 }}>
          <DiagnosticTile
            label="Flair API"
            value={flairStatus.outage.failing ? "Outage" : "Healthy"}
            caption={
              flairStatus.outage.failing && flairStatus.outage.sinceMs !== null
                ? `since ${formatElapsed(new Date(flairStatus.outage.sinceMs).toISOString(), nowMs)}`
                : undefined
            }
            status={flairStatus.outage.failing ? "error" : "success"}
          />
          <DiagnosticTile
            label="Token refresh"
            value={
              flairStatus.tokenRefreshFailure
                ? flairStatus.tokenRefreshFailure.terminal
                  ? "Needs re-auth"
                  : "Transient failure"
                : "OK"
            }
            caption={flairStatus.tokenRefreshFailure?.message}
            status={
              !flairStatus.tokenRefreshFailure
                ? "success"
                : flairStatus.tokenRefreshFailure.terminal
                  ? "error"
                  : "warning"
            }
          />
          <DiagnosticTile
            label="Token budget today"
            value={`${flairStatus.tokenCallsToday} / ${flairStatus.tokenDailyBudget}`}
            caption={`${budgetPct}% of daily budget`}
            status={budgetPct >= 70 ? "warning" : "success"}
          />
        </Stack>
      )}

      <Typography variant="caption" color="text.secondary">
        Phase 0 capability matrix
      </Typography>
      <Table size="small">
        <TableBody>
          {CAPABILITY_MATRIX.map((row) => (
            <TableRow key={row.capability}>
              <TableCell sx={{ pl: 0 }}>{row.capability}</TableCell>
              <TableCell sx={{ color: "text.secondary" }}>
                {row.status}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
