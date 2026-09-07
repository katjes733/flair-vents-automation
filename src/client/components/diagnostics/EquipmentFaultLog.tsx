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
import { formatChartDateTime } from "~/client/components/shared/charts/chartTime";
import SectionHeading from "~/client/components/shared/SectionHeading";

const EQUIPMENT_FAULT_DESCRIPTION =
  "Fires when NONE of an air handler's smart vents show the expected duct-temperature differential for an active call past a grace period (10 minutes by default) — treated as a possible equipment fault (e.g. the compressor isn't actually running). Every smart vent is forced open to 100% until it clears. If even one vent shows the expected differential, that's a per-vent duct issue instead, not a whole-system fault.";

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
          <SectionHeading
            title="Equipment Fault Status"
            description={EQUIPMENT_FAULT_DESCRIPTION}
            sx={{ mb: 1 }}
          />
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
          <SectionHeading
            title={`Fault Periods (this window) — ${historyAirHandlerName}`}
            description={EQUIPMENT_FAULT_DESCRIPTION}
            sx={{ mb: 1 }}
          />
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
                    // The actual end time, not a relative "Xm ago" — a
                    // relative value is hard to place ("was that during
                    // the gaming session?") and goes stale the moment you
                    // stop looking at the page; the absolute time answers
                    // both instantly and matches the chart's own x-axis
                    // convention (formatChartTime/formatChartDateTime).
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
      )}
    </Box>
  );
}
