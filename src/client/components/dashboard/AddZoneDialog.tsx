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
import {
  createZone,
  VENT_HARDWARE_TYPE_LABELS,
  type VentHardwareType,
} from "~/client/api/zonesApi";
import type { AirHandler } from "~/client/api/airHandlersApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import { fromDisplayFlowRate } from "~/shared/types/airflow";
import RepeatableManualVentField, {
  type ManualVentRow,
} from "~/client/components/shared/RepeatableManualVentField";
import { isValidManualVentPosition } from "~/client/components/shared/manualVentValidation";

// A zone's Flair vent identity only ever arrives via "Sync with Flair" —
// a Flair vent id is Flair's own opaque identifier, never something a
// user would type from memory (see RepeatableFlairVentField's own
// comment). So unlike ZoneDetailDialog (which still supports an
// already-linked flair_smart_vent zone), a manually-created zone can
// only ever start out as manual_fixed_vent or no_vent.
const MANUALLY_CREATABLE_VENT_HARDWARE_TYPES: VentHardwareType[] = [
  "manual_fixed_vent",
  "no_vent",
];

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
  const { airflowUnit } = useDisplayUnit();
  const [name, setName] = useState("");
  const [airHandlerId, setAirHandlerId] = useState(airHandlers[0]?.id ?? "");
  const [ventHardwareType, setVentHardwareType] =
    useState<VentHardwareType>("manual_fixed_vent");
  const [manualVents, setManualVents] = useState<ManualVentRow[]>([
    { position: "", ductFlowRateLps: "" },
  ]);
  const [hasTemperatureSensor, setHasTemperatureSensor] = useState(true);
  const [hasOccupancySensor, setHasOccupancySensor] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every field on the closed→open transition (not just on a
  // successful create) — this dialog stays mounted between opens, so
  // without this a cancelled or failed attempt's input, or a previous
  // successful one's leftover state, would still be there next time it's
  // opened. Adjusting state during render on a prop change, mirroring the
  // "seeded" pattern the edit dialogs already use, rather than a
  // useEffect keyed on `open` — that would also need `airHandlers` in its
  // dependency array to pick a live default, which would wipe in-progress
  // input on every background zones-list refresh while the dialog is open.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setAirHandlerId(airHandlers[0]?.id ?? "");
      setVentHardwareType("manual_fixed_vent");
      setManualVents([{ position: "", ductFlowRateLps: "" }]);
      setHasTemperatureSensor(true);
      setHasOccupancySensor(false);
      setError(null);
    }
  }

  const manualVentsValid =
    manualVents.length > 0 &&
    manualVents.every((v) => isValidManualVentPosition(v.position));

  const handleSubmit = useCallback(async () => {
    if (!name.trim() || !airHandlerId) return;
    setSubmitting(true);
    setError(null);
    try {
      await createZone({
        air_handler_id: airHandlerId,
        // A manually-created zone never starts out Flair-linked — see
        // MANUALLY_CREATABLE_VENT_HARDWARE_TYPES above; linking a Flair
        // room happens later, via "Sync with Flair".
        flair_room_id: null,
        name: name.trim(),
        vent_hardware_type: ventHardwareType,
        config: {
          has_temperature_sensor: hasTemperatureSensor,
          has_occupancy_sensor: hasOccupancySensor,
          flair_vents: [],
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
      showNotification(`Zone "${name.trim()}" created.`, "success");
      onCreated();
      onClose();
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
    airflowUnit,
    hasOccupancySensor,
    hasTemperatureSensor,
    manualVents,
    name,
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
            helperText={
              'Flair smart vents can only be added via "Sync with Flair," once a zone is linked to a real Flair room.'
            }
          >
            {MANUALLY_CREATABLE_VENT_HARDWARE_TYPES.map((type) => (
              <MenuItem key={type} value={type}>
                {VENT_HARDWARE_TYPE_LABELS[type]}
              </MenuItem>
            ))}
          </TextField>

          {ventHardwareType === "manual_fixed_vent" && (
            <RepeatableManualVentField
              values={manualVents}
              onChange={setManualVents}
              airflowUnit={airflowUnit}
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
            (ventHardwareType === "manual_fixed_vent" && !manualVentsValid) ||
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
