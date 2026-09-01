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
import { createZone, type VentHardwareType } from "~/client/api/zonesApi";
import type { AirHandler } from "~/client/api/airHandlersApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";
import RepeatableTextField from "~/client/components/shared/RepeatableTextField";

const HARDWARE_TYPE_LABELS: Record<VentHardwareType, string> = {
  flair_smart_vent: "Flair smart vent",
  manual_fixed_vent: "Manual fixed vent",
  no_vent: "No vent (sensor only)",
};

interface AddZoneDialogProps {
  open: boolean;
  airHandlers: AirHandler[];
  onClose: () => void;
  onCreated: () => void;
}

export default function AddZoneDialog({
  open,
  airHandlers,
  onClose,
  onCreated,
}: AddZoneDialogProps) {
  const { showNotification } = useNotification();
  const [name, setName] = useState("");
  const [airHandlerId, setAirHandlerId] = useState(airHandlers[0]?.id ?? "");
  const [ventHardwareType, setVentHardwareType] =
    useState<VentHardwareType>("flair_smart_vent");
  const [flairRoomId, setFlairRoomId] = useState("");
  const [flairVentIds, setFlairVentIds] = useState<string[]>([""]);
  const [assumedFixedPosition, setAssumedFixedPosition] = useState("");
  const [hasTemperatureSensor, setHasTemperatureSensor] = useState(true);
  const [hasOccupancySensor, setHasOccupancySensor] = useState(false);
  const [ductFlowRateLps, setDuctFlowRateLps] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nonBlankVentIds = flairVentIds.map((v) => v.trim()).filter(Boolean);

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || !airHandlerId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createZone({
        air_handler_id: airHandlerId,
        flair_room_id:
          ventHardwareType === "flair_smart_vent" && flairRoomId.trim()
            ? flairRoomId.trim()
            : null,
        name: name.trim(),
        vent_hardware_type: ventHardwareType,
        config: {
          has_temperature_sensor: hasTemperatureSensor,
          has_occupancy_sensor: hasOccupancySensor,
          flair_vent_ids:
            ventHardwareType === "flair_smart_vent" ? nonBlankVentIds : [],
          ...(ventHardwareType === "manual_fixed_vent" &&
          assumedFixedPosition.trim()
            ? { assumed_fixed_position: Number(assumedFixedPosition) }
            : {}),
          ...(ductFlowRateLps.trim()
            ? { duct_flow_rate_lps: Number(ductFlowRateLps) }
            : {}),
        },
      });
      showNotification(`Zone "${name.trim()}" created.`, "success");
      onCreated();
      onClose();
      setName("");
      setFlairRoomId("");
      setFlairVentIds([""]);
      setAssumedFixedPosition("");
      setDuctFlowRateLps("");
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "Couldn't create the zone — check the fields and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [
    airHandlerId,
    assumedFixedPosition,
    ductFlowRateLps,
    flairRoomId,
    hasOccupancySensor,
    hasTemperatureSensor,
    name,
    nonBlankVentIds,
    onClose,
    onCreated,
    showNotification,
    ventHardwareType,
  ]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add zone</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            autoFocus
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            select
            label="Air handler"
            value={airHandlerId}
            onChange={(e) => setAirHandlerId(e.target.value)}
          >
            {airHandlers.map((ah) => (
              <MenuItem key={ah.id} value={ah.id}>
                {ah.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Vent hardware type"
            value={ventHardwareType}
            onChange={(e) =>
              setVentHardwareType(e.target.value as VentHardwareType)
            }
          >
            {Object.entries(HARDWARE_TYPE_LABELS).map(([type, label]) => (
              <MenuItem key={type} value={type}>
                {label}
              </MenuItem>
            ))}
          </TextField>

          {ventHardwareType === "flair_smart_vent" && (
            <>
              <TextField
                label="Flair room ID (optional)"
                value={flairRoomId}
                onChange={(e) => setFlairRoomId(e.target.value)}
                helperText="Link to a real Flair room now, or leave blank and link it later."
              />
              <RepeatableTextField
                label="Flair vent ID"
                addLabel="Add another vent"
                values={flairVentIds}
                onChange={setFlairVentIds}
              />
            </>
          )}

          {ventHardwareType === "manual_fixed_vent" && (
            <TextField
              label="Fixed position (0–100%)"
              type="number"
              value={assumedFixedPosition}
              onChange={(e) => setAssumedFixedPosition(e.target.value)}
              helperText="Required for a manual fixed vent."
            />
          )}

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
          disabled={
            !name.trim() ||
            !airHandlerId ||
            (ventHardwareType === "manual_fixed_vent" &&
              !assumedFixedPosition.trim()) ||
            (ventHardwareType === "flair_smart_vent" &&
              nonBlankVentIds.length === 0) ||
            submitting
          }
          onClick={handleSubmit}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
