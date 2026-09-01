import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import type {
  AirHandler,
  AirHandlerTickDecision,
} from "~/client/api/airHandlersApi";
import { DiagnosticOnly } from "~/client/components/shared/DiagnosticOnly";

interface AirHandlerStatusCardProps {
  airHandler: AirHandler;
  decision: AirHandlerTickDecision | null;
  isLive: boolean;
}

const HVAC_STATE_LABELS: Record<string, string> = {
  COOLING_CALL: "Cooling",
  HEATING_CALL: "Heating",
  FAN_ONLY: "Fan only",
  IDLE: "Idle",
};

export default function AirHandlerStatusCard({
  airHandler,
  decision,
  isLive,
}: AirHandlerStatusCardProps) {
  const drivingZoneName = decision?.driving_zone?.zone_id
    ? decision.zones.find((z) => z.zone_id === decision.driving_zone?.zone_id)
        ?.name
    : null;

  return (
    <Card variant="outlined" sx={{ width: "100%", mb: 2 }}>
      <CardContent>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 1,
          }}
        >
          <Typography variant="h6">{airHandler.name}</Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            {!isLive && <Chip label="Shadow Mode" color="info" size="small" />}
            {decision && (
              <Chip
                label={
                  HVAC_STATE_LABELS[decision.hvac_state] ?? decision.hvac_state
                }
                size="small"
                color={
                  decision.hvac_state === "COOLING_CALL" ||
                  decision.hvac_state === "HEATING_CALL"
                    ? "primary"
                    : "default"
                }
              />
            )}
          </Box>
        </Box>

        {decision && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {decision.narrative}
            </Typography>

            {drivingZoneName && (
              <Typography variant="body2" sx={{ mb: 1 }}>
                Tracking <strong>{drivingZoneName}</strong> (
                {decision.driving_zone?.reason.replace(/_/g, " ")})
                {decision.setpoint_push?.pushed_value !== null &&
                  decision.setpoint_push !== null &&
                  ` — pushed setpoint ${decision.setpoint_push.pushed_value.toFixed(1)}°C`}
              </Typography>
            )}

            {decision.pressure && (
              <Box sx={{ mt: 1 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    mb: 0.5,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    Open capacity
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {decision.pressure.aggregate_open_pct.toFixed(0)}%
                    {decision.pressure.clamped && " (floor-clamped)"}
                  </Typography>
                </Box>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(100, decision.pressure.aggregate_open_pct)}
                  color={decision.pressure.clamped ? "warning" : "primary"}
                />
                <DiagnosticOnly>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.5 }}
                  >
                    Floor {decision.pressure.floor_lps.toFixed(0)} L/s
                    {decision.pressure.minimum_aggregate_flow_is_estimate
                      ? " (estimate)"
                      : " (confirmed)"}
                    {" · "}
                    Blower rating{" "}
                    {decision.pressure.blower_rated_flow_rate_is_estimate
                      ? "estimated"
                      : "confirmed"}
                  </Typography>
                </DiagnosticOnly>
              </Box>
            )}
          </>
        )}

        {!decision && (
          <Typography variant="body2" color="text.secondary">
            No tick decision yet — waiting for the control loop's first cycle.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
