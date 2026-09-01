import { useCallback, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Stack from "@mui/material/Stack";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import DialogContentText from "@mui/material/DialogContentText";
import Typography from "@mui/material/Typography";
import { updateZone, type Zone } from "~/client/api/zonesApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";
import RepeatableTextField from "~/client/components/shared/RepeatableTextField";

interface ZoneDetailDialogProps {
  open: boolean;
  zone: Zone | null;
  onClose: () => void;
  onSaved: () => void;
}

// undefined/"" means "unset" for comfort_tolerance — a real, distinct
// state from 0 (see zoneConfigSchema's own comment: unset means tight
// targeting). The form preserves that distinction rather than defaulting
// a blank field to 0.
export default function ZoneDetailDialog({
  open,
  zone,
  onClose,
  onSaved,
}: ZoneDetailDialogProps) {
  const { showNotification } = useNotification();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [idleBaseline, setIdleBaseline] = useState("100");
  const [comfortTolerance, setComfortTolerance] = useState("");
  const [calibrationOffset, setCalibrationOffset] = useState("0");
  const [minPosition, setMinPosition] = useState("0");
  const [maxPosition, setMaxPosition] = useState("100");
  const [ductFlowRateLps, setDuctFlowRateLps] = useState("");
  const [assumedFixedPosition, setAssumedFixedPosition] = useState("");
  const [hasTemperatureSensor, setHasTemperatureSensor] = useState(true);
  const [hasOccupancySensor, setHasOccupancySensor] = useState(false);
  const [flairVentIds, setFlairVentIds] = useState<string[]>([""]);

  // Re-seed the form whenever a different zone is opened.
  const [seededZoneId, setSeededZoneId] = useState<string | null>(null);
  if (zone && zone.id !== seededZoneId) {
    setSeededZoneId(zone.id);
    setIdleBaseline(String(zone.config.idle_baseline_position));
    setComfortTolerance(
      zone.config.comfort_tolerance !== undefined
        ? String(zone.config.comfort_tolerance)
        : "",
    );
    setCalibrationOffset(String(zone.config.sensor_calibration_offset));
    setMinPosition(String(zone.config.min_vent_position));
    setMaxPosition(String(zone.config.max_vent_position));
    setDuctFlowRateLps(
      zone.config.duct_flow_rate_lps !== undefined
        ? String(zone.config.duct_flow_rate_lps)
        : "",
    );
    setAssumedFixedPosition(
      zone.config.assumed_fixed_position !== undefined
        ? String(zone.config.assumed_fixed_position)
        : "",
    );
    setHasTemperatureSensor(zone.config.has_temperature_sensor);
    setHasOccupancySensor(zone.config.has_occupancy_sensor);
    setFlairVentIds(
      zone.config.flair_vent_ids.length > 0 ? zone.config.flair_vent_ids : [""],
    );
  }

  const nonBlankVentIds = flairVentIds.map((v) => v.trim()).filter(Boolean);

  const handleSubmit = useCallback(async () => {
    if (!zone) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateZone(zone.id, {
        config: {
          has_temperature_sensor: hasTemperatureSensor,
          has_occupancy_sensor: hasOccupancySensor,
          flair_vent_ids:
            zone.ventHardwareType === "flair_smart_vent" ? nonBlankVentIds : [],
          idle_baseline_position: Number(idleBaseline),
          min_vent_position: Number(minPosition),
          max_vent_position: Number(maxPosition),
          sensor_calibration_offset: Number(calibrationOffset),
          comfort_tolerance:
            comfortTolerance.trim() === ""
              ? undefined
              : Number(comfortTolerance),
          duct_flow_rate_lps:
            ductFlowRateLps.trim() === "" ? undefined : Number(ductFlowRateLps),
          ...(zone.ventHardwareType === "manual_fixed_vent" && {
            assumed_fixed_position:
              assumedFixedPosition.trim() === ""
                ? undefined
                : Number(assumedFixedPosition),
          }),
        },
      });
      showNotification(`"${zone.name}" updated.`, "success");
      onSaved();
      onClose();
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "Couldn't save — check the fields and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    assumedFixedPosition,
    calibrationOffset,
    comfortTolerance,
    ductFlowRateLps,
    hasOccupancySensor,
    hasTemperatureSensor,
    idleBaseline,
    maxPosition,
    minPosition,
    nonBlankVentIds,
    onClose,
    onSaved,
    showNotification,
    zone,
  ]);

  if (!zone) return null;
  const isSmartVent = zone.ventHardwareType === "flair_smart_vent";

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{zone.name} — configuration</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={hasTemperatureSensor}
                onChange={(e) => setHasTemperatureSensor(e.target.checked)}
              />
            }
            label="Has temperature sensor"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={hasOccupancySensor}
                onChange={(e) => setHasOccupancySensor(e.target.checked)}
              />
            }
            label="Has occupancy sensor"
          />

          {isSmartVent && (
            <>
              <Typography variant="subtitle2" color="text.secondary">
                Vents
              </Typography>
              <RepeatableTextField
                label="Flair vent ID"
                addLabel="Add another vent"
                values={flairVentIds}
                onChange={setFlairVentIds}
              />
              <Typography variant="subtitle2" color="text.secondary">
                Position
              </Typography>
              <TextField
                label="Idle baseline (0–100%)"
                type="number"
                value={idleBaseline}
                onChange={(e) => setIdleBaseline(e.target.value)}
              />
              <Stack direction="row" spacing={2}>
                <TextField
                  label="Min position"
                  type="number"
                  fullWidth
                  value={minPosition}
                  onChange={(e) => setMinPosition(e.target.value)}
                />
                <TextField
                  label="Max position"
                  type="number"
                  fullWidth
                  value={maxPosition}
                  onChange={(e) => setMaxPosition(e.target.value)}
                />
              </Stack>
            </>
          )}

          {zone.ventHardwareType === "manual_fixed_vent" && (
            <TextField
              label="Fixed position (0–100%)"
              type="number"
              value={assumedFixedPosition}
              onChange={(e) => setAssumedFixedPosition(e.target.value)}
            />
          )}

          {hasTemperatureSensor && (
            <>
              <Typography variant="subtitle2" color="text.secondary">
                Comfort
              </Typography>
              <TextField
                label="Comfort tolerance, °C (blank = tight)"
                type="number"
                value={comfortTolerance}
                onChange={(e) => setComfortTolerance(e.target.value)}
              />
              <TextField
                label="Sensor calibration offset, °C"
                type="number"
                value={calibrationOffset}
                onChange={(e) => setCalibrationOffset(e.target.value)}
              />
            </>
          )}

          <TextField
            label="Duct airflow rating, L/s (optional)"
            type="number"
            value={ductFlowRateLps}
            onChange={(e) => setDuctFlowRateLps(e.target.value)}
            helperText="Falls back to a standard-duct default if left blank."
          />

          {error && (
            <DialogContentText color="error">{error}</DialogContentText>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={submitting || (isSmartVent && nonBlankVentIds.length === 0)}
          onClick={handleSubmit}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
