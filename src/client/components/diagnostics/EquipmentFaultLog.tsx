import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type {
  AirHandler,
  AirHandlerTickDecision,
} from "~/client/api/airHandlersApi";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";
import DiagnosticTile from "~/client/components/diagnostics/DiagnosticTile";
import { computeFaultPeriodsForAirHandler } from "~/client/components/telemetry/chartData";

interface EquipmentFaultLogProps {
  airHandlers: AirHandler[];
  tickDecisionsByAirHandlerId: Map<string, AirHandlerTickDecision | null>;
  // Optional — only ever supplied by TelemetryPage, for whichever one air
  // handler is currently selected there. See DegradedVentHistory's own
  // comment on why this is an addition, not a behavior change for
  // DiagnosticsPage (which never passes it).
  historyPoints?: TickHistoryPoint[];
  historyAirHandlerId?: string;
  historyAirHandlerName?: string;
  // See DegradedVentHistory's identical prop — TelemetryPage sets this
  // since it has no live-status cache to show honestly.
  hideCurrentStatus?: boolean;
}

/**
 * Current-status half: whether the Emergency Fail-Safe (see "Emergency
 * fail-safe") is active right now for each air handler — see
 * "Stage 12 — Current-Status Diagnostics". The optional `historyPoints`/
 * `historyAirHandlerId` props add the Increment-B historical half onto the
 * SAME component, same reasoning as DegradedVentHistory.
 */
export default function EquipmentFaultLog({
  airHandlers,
  tickDecisionsByAirHandlerId,
  historyPoints,
  historyAirHandlerId,
  historyAirHandlerName,
  hideCurrentStatus = false,
}: EquipmentFaultLogProps) {
  const historyPeriods =
    historyPoints && historyPoints.length > 0
      ? computeFaultPeriodsForAirHandler(
          historyPoints,
          historyPoints[historyPoints.length - 1].loggedAtMs,
        )
      : [];
  const historyDomainEndMs =
    historyPoints && historyPoints.length > 0
      ? historyPoints[historyPoints.length - 1].loggedAtMs
      : 0;

  return (
    <Box>
      {!hideCurrentStatus && (
        <>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Equipment Fault Status
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={1.5}>
            {airHandlers.map((ah) => {
              const decision = tickDecisionsByAirHandlerId.get(ah.id);
              const active = decision?.equipment_fault_active ?? false;
              return (
                <DiagnosticTile
                  key={ah.id}
                  label={ah.name}
                  value={active ? "Fault active" : "Normal"}
                  caption={
                    decision === undefined || decision === null
                      ? "No tick decision yet"
                      : undefined
                  }
                  status={active ? "error" : "success"}
                />
              );
            })}
          </Stack>
        </>
      )}

      {historyPoints && historyPoints.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
            Fault Periods (this window) — {historyAirHandlerName}
          </Typography>
          {historyPeriods.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No fault periods in this window.
            </Typography>
          ) : (
            <Stack direction="row" flexWrap="wrap" gap={1.5}>
              {historyPeriods.map((p, i) => {
                const endedAgoMs = historyDomainEndMs - p.endMs;
                return (
                  <DiagnosticTile
                    key={`${historyAirHandlerId}:${i}`}
                    label={historyAirHandlerName ?? ""}
                    value={`${Math.round((p.endMs - p.startMs) / 60_000)}m`}
                    caption={
                      endedAgoMs <= 0
                        ? "ongoing"
                        : `ended ${Math.round(endedAgoMs / 60_000)}m ago`
                    }
                    status="warning"
                  />
                );
              })}
            </Stack>
          )}
        </Box>
      )}
    </Box>
  );
}
