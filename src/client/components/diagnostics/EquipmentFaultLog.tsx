import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import type {
  AirHandler,
  AirHandlerTickDecision,
} from "~/client/api/airHandlersApi";
import DiagnosticTile from "~/client/components/diagnostics/DiagnosticTile";

interface EquipmentFaultLogProps {
  airHandlers: AirHandler[];
  tickDecisionsByAirHandlerId: Map<string, AirHandlerTickDecision | null>;
}

/**
 * **Current-status only** — whether the Emergency Fail-Safe (see
 * "Emergency fail-safe") is active right now for each air handler. Named
 * for its eventual Increment-B form (a scrollable history of past
 * fail-safe/duct-anomaly events, sourced from Loki), same reasoning as
 * DegradedVentHistory. See "Stage 12 — Current-Status Diagnostics".
 */
export default function EquipmentFaultLog({
  airHandlers,
  tickDecisionsByAirHandlerId,
}: EquipmentFaultLogProps) {
  return (
    <Box>
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
    </Box>
  );
}
