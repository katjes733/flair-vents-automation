import { useCallback, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import DialogContentText from "@mui/material/DialogContentText";
import Typography from "@mui/material/Typography";
import {
  updateZone,
  deleteZone,
  VENT_HARDWARE_TYPE_LABELS,
  type VentHardwareType,
  type Zone,
} from "~/client/api/zonesApi";
import type { ZoneTickDecisionRecord } from "~/client/api/airHandlersApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import {
  asTempDelta,
  toDisplayDelta,
  fromDisplayDelta,
} from "~/shared/types/temperature";
import { toDisplayFlowRate, fromDisplayFlowRate } from "~/shared/types/airflow";
import RepeatableManualVentField, {
  isValidManualVentPosition,
  type ManualVentRow,
} from "~/client/components/shared/RepeatableManualVentField";
import RepeatableFlairVentField, {
  type FlairVentRow,
} from "~/client/components/shared/RepeatableFlairVentField";

interface ZoneDetailDialogProps {
  open: boolean;
  zone: Zone | null;
  // The zone's latest tick decision, if any — used only to resolve each
  // Flair vent's real nickname for display (see
  // RepeatableFlairVentField's own comment); undefined before the zone's
  // first tick, or if it isn't a flair_smart_vent zone.
  tickRecord?: ZoneTickDecisionRecord;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

// undefined/"" means "unset" for comfort_tolerance — a real, distinct
// state from 0 (see zoneConfigSchema's own comment: unset means tight
// targeting). The form preserves that distinction rather than defaulting
// a blank field to 0.
export default function ZoneDetailDialog({
  open,
  zone,
  tickRecord,
  onClose,
  onSaved,
  onDeleted,
}: ZoneDetailDialogProps) {
  const { showNotification } = useNotification();
  const { temperatureUnit, airflowUnit } = useDisplayUnit();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [ventHardwareType, setVentHardwareType] =
    useState<VentHardwareType>("flair_smart_vent");
  const [idleBaseline, setIdleBaseline] = useState("100");
  const [comfortTolerance, setComfortTolerance] = useState("");
  const [calibrationOffset, setCalibrationOffset] = useState("0");
  const [minPosition, setMinPosition] = useState("0");
  const [maxPosition, setMaxPosition] = useState("100");
  const [manualVents, setManualVents] = useState<ManualVentRow[]>([
    { position: "", ductFlowRateLps: "" },
  ]);
  const [hasTemperatureSensor, setHasTemperatureSensor] = useState(true);
  const [hasOccupancySensor, setHasOccupancySensor] = useState(false);
  const [flairVents, setFlairVents] = useState<FlairVentRow[]>([
    { flairVentId: "", ductFlowRateLps: "" },
  ]);

  // Re-seed the form whenever a different zone is opened.
  const [seededZoneId, setSeededZoneId] = useState<string | null>(null);
  if (zone && zone.id !== seededZoneId) {
    setSeededZoneId(zone.id);
    setVentHardwareType(zone.ventHardwareType);
    setIdleBaseline(String(zone.config.idle_baseline_position));
    setComfortTolerance(
      zone.config.comfort_tolerance !== undefined
        ? toDisplayDelta(
            asTempDelta(zone.config.comfort_tolerance),
            temperatureUnit,
          ).toFixed(1)
        : "",
    );
    setCalibrationOffset(
      toDisplayDelta(
        asTempDelta(zone.config.sensor_calibration_offset),
        temperatureUnit,
      ).toFixed(1),
    );
    setMinPosition(String(zone.config.min_vent_position));
    setMaxPosition(String(zone.config.max_vent_position));
    setManualVents(
      zone.config.manual_vents.length > 0
        ? zone.config.manual_vents.map((v) => ({
            position: String(v.position),
            ductFlowRateLps:
              v.duct_flow_rate_lps !== undefined
                ? toDisplayFlowRate(v.duct_flow_rate_lps, airflowUnit).toFixed(
                    1,
                  )
                : "",
          }))
        : [{ position: "", ductFlowRateLps: "" }],
    );
    setHasTemperatureSensor(zone.config.has_temperature_sensor);
    setHasOccupancySensor(zone.config.has_occupancy_sensor);
    setFlairVents(
      zone.config.flair_vents.length > 0
        ? zone.config.flair_vents.map((v) => ({
            flairVentId: v.flair_vent_id,
            ductFlowRateLps:
              v.duct_flow_rate_lps !== undefined
                ? toDisplayFlowRate(v.duct_flow_rate_lps, airflowUnit).toFixed(
                    1,
                  )
                : "",
          }))
        : [{ flairVentId: "", ductFlowRateLps: "" }],
    );
  }

  const nonBlankFlairVents = flairVents.filter((v) => v.flairVentId.trim());
  const ventNameByFlairVentId = new Map(
    (tickRecord?.vents ?? [])
      .filter((v) => v.name)
      .map((v) => [v.flair_vent_id, v.name]),
  );
  const manualVentsValid =
    manualVents.length > 0 &&
    manualVents.every((v) => isValidManualVentPosition(v.position));

  const handleSubmit = useCallback(async () => {
    if (!zone) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateZone(zone.id, {
        vent_hardware_type: ventHardwareType,
        config: {
          has_temperature_sensor: hasTemperatureSensor,
          has_occupancy_sensor: hasOccupancySensor,
          flair_vents:
            ventHardwareType === "flair_smart_vent"
              ? nonBlankFlairVents.map((v) => ({
                  flair_vent_id: v.flairVentId.trim(),
                  ...(v.ductFlowRateLps.trim()
                    ? {
                        duct_flow_rate_lps: fromDisplayFlowRate(
                          Number(v.ductFlowRateLps),
                          airflowUnit,
                        ),
                      }
                    : {}),
                }))
              : [],
          idle_baseline_position: Number(idleBaseline),
          min_vent_position: Number(minPosition),
          max_vent_position: Number(maxPosition),
          sensor_calibration_offset: fromDisplayDelta(
            Number(calibrationOffset),
            temperatureUnit,
          ),
          comfort_tolerance:
            comfortTolerance.trim() === ""
              ? undefined
              : fromDisplayDelta(Number(comfortTolerance), temperatureUnit),
          manual_vents:
            ventHardwareType === "manual_fixed_vent"
              ? manualVents.map((v) => ({
                  position: Number(v.position),
                  ...(v.ductFlowRateLps.trim()
                    ? {
                        duct_flow_rate_lps: fromDisplayFlowRate(
                          Number(v.ductFlowRateLps),
                          airflowUnit,
                        ),
                      }
                    : {}),
                }))
              : [],
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
    airflowUnit,
    calibrationOffset,
    comfortTolerance,
    hasOccupancySensor,
    hasTemperatureSensor,
    idleBaseline,
    manualVents,
    maxPosition,
    minPosition,
    nonBlankFlairVents,
    onClose,
    onSaved,
    showNotification,
    temperatureUnit,
    ventHardwareType,
    zone,
  ]);

  const handleDelete = useCallback(async () => {
    if (!zone) return;
    setSubmitting(true);
    setDeleteError(null);
    try {
      await deleteZone(zone.id);
      showNotification(`"${zone.name}" deleted.`, "success");
      setConfirmDeleteOpen(false);
      onDeleted();
      onClose();
    } catch (err) {
      setDeleteError(
        extractErrorMessage(err) ?? "Couldn't delete — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [zone, onClose, onDeleted, showNotification]);

  if (!zone) return null;
  const isSmartVent = ventHardwareType === "flair_smart_vent";
  const isManualFixedVent = ventHardwareType === "manual_fixed_vent";

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>{zone.name} — configuration</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              select
              label="Vent hardware type"
              value={ventHardwareType}
              onChange={(e) =>
                setVentHardwareType(e.target.value as VentHardwareType)
              }
            >
              {Object.entries(VENT_HARDWARE_TYPE_LABELS).map(
                ([type, label]) => (
                  <MenuItem key={type} value={type}>
                    {label}
                  </MenuItem>
                ),
              )}
            </TextField>

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
                <RepeatableFlairVentField
                  values={flairVents}
                  onChange={setFlairVents}
                  airflowUnit={airflowUnit}
                  ventNameByFlairVentId={ventNameByFlairVentId}
                  idEditable={false}
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

            {isManualFixedVent && (
              <>
                <Typography variant="subtitle2" color="text.secondary">
                  Vents
                </Typography>
                <RepeatableManualVentField
                  values={manualVents}
                  onChange={setManualVents}
                  airflowUnit={airflowUnit}
                />
              </>
            )}

            {hasTemperatureSensor && (
              <>
                <Typography variant="subtitle2" color="text.secondary">
                  Comfort
                </Typography>
                <TextField
                  label={`Comfort tolerance, °${temperatureUnit} (blank = tight)`}
                  type="number"
                  value={comfortTolerance}
                  onChange={(e) => setComfortTolerance(e.target.value)}
                />
                <TextField
                  label={`Sensor calibration offset, °${temperatureUnit}`}
                  type="number"
                  value={calibrationOffset}
                  onChange={(e) => setCalibrationOffset(e.target.value)}
                />
              </>
            )}

            {error && (
              <DialogContentText color="error">{error}</DialogContentText>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between", px: 3 }}>
          <Button color="error" onClick={() => setConfirmDeleteOpen(true)}>
            Delete
          </Button>
          <Stack direction="row" spacing={1}>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              disabled={
                submitting ||
                (isSmartVent && nonBlankFlairVents.length === 0) ||
                (isManualFixedVent && !manualVentsValid)
              }
              onClick={handleSubmit}
            >
              Save
            </Button>
          </Stack>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
      >
        <DialogTitle>Delete "{zone.name}"?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This can't be undone. Deletion is refused if any schedule still
            references this zone — remove it from those schedules first.
          </DialogContentText>
          {deleteError && (
            <DialogContentText color="error" sx={{ mt: 1 }}>
              {deleteError}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={submitting}
            onClick={handleDelete}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
