import { useCallback, useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import type {
  AirHandler,
  AirHandlerTickDecision,
} from "~/client/api/airHandlersApi";
import { DiagnosticOnly } from "~/client/components/shared/DiagnosticOnly";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import { useNotification } from "~/client/components/notification/useNotification";
import { asAbsoluteTemp, toDisplayAbsolute } from "~/shared/types/temperature";
import { toDisplayFlowRate, AIRFLOW_UNIT_LABELS } from "~/shared/types/airflow";

interface AirHandlerStatusCardProps {
  airHandler: AirHandler;
  decision: AirHandlerTickDecision | null;
  // Whether this handler is in `system_settings.config.live_air_handler_ids`
  // — the per-handler promotion flag, distinct from whether it's *actually*
  // dispatching (that also needs the global `DRY_RUN` env var off — see
  // `decision.dry_run` below). Named "promoted", not "live", specifically
  // so it can't be misread as "currently dispatching real commands."
  isPromoted: boolean;
  // The real, global DRY_RUN env var value (see settingsApi's own
  // comment) — surfaced only for the badge tooltip's full breakdown, per
  // "close the gap" between `decision.dry_run` (which is always `true`
  // for a not-yet-promoted handler regardless of the real global value —
  // see the badge tooltip logic below) and the actual global state.
  globalDryRun: boolean;
  // Adds/removes this handler from `live_air_handler_ids` and refreshes —
  // owned by the caller (DashboardPage), which holds the full array this
  // card only sees one boolean slice of. Rejection surfaces as a
  // notification here, not to the caller.
  onTogglePromoted: () => Promise<void>;
  // The "Edit"/"Sync with Flair" actions, rendered in the card's own
  // header row instead of a separate toolbar row above it — the same
  // reasoning as GlobalStatusBar's own `children` slot: reclaim the
  // vertical space a dedicated row costs.
  children?: React.ReactNode;
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
  isPromoted,
  globalDryRun,
  onTogglePromoted,
  children,
}: AirHandlerStatusCardProps) {
  const { temperatureUnit, airflowUnit } = useDisplayUnit();
  const { showNotification } = useNotification();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const drivingZoneName = decision?.driving_zone?.zone_id
    ? decision.zones.find((z) => z.zone_id === decision.driving_zone?.zone_id)
        ?.name
    : null;

  // The true, combined effective state — `decision.dry_run` is computed
  // server-side every tick as `globalDryRun || !live_air_handler_ids
  // .includes(id)`, so it already reflects both gates at once. Driving the
  // badge off this (not off `isPromoted` alone) is what makes "promoted but
  // DRY_RUN is still on" a visibly distinct state instead of silently
  // looking identical to genuinely live.
  const actuallyLive = decision !== null && decision.dry_run === false;

  // The full breakdown behind the badge, so a not-yet-promoted handler
  // (whose own decision.dry_run is always `true` regardless of the real
  // global value) doesn't leave the actual DRY_RUN state a mystery —
  // see "close the gap" in the implementation plan's DRY_RUN/
  // live_air_handler_ids discussion.
  const badgeTooltip = `DRY_RUN (global, redeploy-gated): ${globalDryRun ? "on" : "off"} · Promoted (live_air_handler_ids): ${isPromoted ? "yes" : "no"}`;

  const handleConfirm = useCallback(async () => {
    setSubmitting(true);
    try {
      await onTogglePromoted();
      showNotification(
        isPromoted
          ? `${airHandler.name} removed from live control.`
          : `${airHandler.name} added to live control.`,
        "success",
      );
      setConfirmOpen(false);
    } catch {
      showNotification("That didn't go through — try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }, [airHandler.name, isPromoted, onTogglePromoted, showNotification]);

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
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 1,
            }}
          >
            <Tooltip title={badgeTooltip}>
              <Chip
                label={
                  !isPromoted
                    ? "Shadow Mode"
                    : actuallyLive
                      ? "Live"
                      : "Promoted — DRY_RUN still on"
                }
                color={
                  !isPromoted ? "info" : actuallyLive ? "success" : "warning"
                }
                size="small"
                onClick={() => setConfirmOpen(true)}
              />
            </Tooltip>
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
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {children}
          </Box>
        </Box>

        {decision && (
          <>
            {decision.setpoint_push && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Ecobee (live)
                </Typography>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
                  <Typography variant="h5">
                    {decision.setpoint_push.thermostat_reading !== null
                      ? `${toDisplayAbsolute(asAbsoluteTemp(decision.setpoint_push.thermostat_reading), temperatureUnit).toFixed(1)}°${temperatureUnit}`
                      : "—"}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    reading
                    {decision.setpoint_push.thermostat_current_setpoint !==
                      null &&
                      ` · holding ${toDisplayAbsolute(asAbsoluteTemp(decision.setpoint_push.thermostat_current_setpoint), temperatureUnit).toFixed(1)}°${temperatureUnit}`}
                  </Typography>
                </Box>

                {decision.setpoint_push.pushed_value !== null && (
                  <>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.5 }}
                    >
                      This app's computed call
                    </Typography>
                    <Typography variant="body2">
                      {`${toDisplayAbsolute(asAbsoluteTemp(decision.setpoint_push.pushed_value), temperatureUnit).toFixed(1)}°${temperatureUnit}`}
                      {!decision.setpoint_push.would_write && " (not written)"}
                    </Typography>
                  </>
                )}
              </Box>
            )}

            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {decision.narrative}
            </Typography>

            {drivingZoneName && (
              <Typography variant="body2" sx={{ mb: 1 }}>
                Tracking <strong>{drivingZoneName}</strong> (
                {decision.driving_zone?.reason.replace(/_/g, " ")})
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
                    Floor{" "}
                    {toDisplayFlowRate(
                      decision.pressure.floor_lps,
                      airflowUnit,
                    ).toFixed(0)}{" "}
                    {AIRFLOW_UNIT_LABELS[airflowUnit]}
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

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>
          {isPromoted
            ? `Remove ${airHandler.name} from live control?`
            : `Add ${airHandler.name} to live control?`}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {isPromoted
              ? `${airHandler.name} will stop dispatching real commands and fall back to shadow mode on its next tick.`
              : `This only adds ${airHandler.name} to the live-control list — it won't actually start dispatching real commands unless DRY_RUN is also disabled, which requires a deliberate redeploy. Until then it stays fully in shadow mode.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={submitting}
            color={isPromoted ? "warning" : "primary"}
            variant="contained"
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}
