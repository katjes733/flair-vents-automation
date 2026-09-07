import { useCallback, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Stack from "@mui/material/Stack";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import {
  updateAirHandler,
  deleteAirHandler,
  type AirHandler,
} from "~/client/api/airHandlersApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";
import FlairZoneSelect from "~/client/components/shared/FlairZoneSelect";
import { useCanWrite } from "~/client/permissions/usePermission";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import {
  asAbsoluteTemp,
  asTempDelta,
  toDisplayAbsolute,
  fromDisplayAbsolute,
  toDisplayDelta,
  fromDisplayDelta,
} from "~/shared/types/temperature";

interface EditAirHandlerDialogProps {
  open: boolean;
  airHandler: AirHandler | null;
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

/**
 * The edit half of `AddAirHandlerDialog` — the server's PATCH route
 * already supported every one of these fields (including `flair_zone_id`,
 * needed to link an air handler to Flair after creating it without one),
 * there was just no UI calling it. Delete is nested here rather than a
 * separate toolbar action, mirroring `GlobalStatusBar`'s own
 * confirm-dialog-inside-the-feature pattern.
 */
export default function EditAirHandlerDialog({
  open,
  airHandler,
  onClose,
  onSaved,
  onDeleted,
}: EditAirHandlerDialogProps) {
  const { showNotification } = useNotification();
  const { temperatureUnit } = useDisplayUnit();
  const canEdit = useCanWrite("dashboard.airHandler.edit");
  const canDelete = useCanWrite("dashboard.airHandler.delete");
  const [name, setName] = useState("");
  const [tonnageTons, setTonnageTons] = useState("");
  const [flairZoneId, setFlairZoneId] = useState("");
  const [active, setActive] = useState(true);
  const [awayCoolOverride, setAwayCoolOverride] = useState("");
  const [awayHeatOverride, setAwayHeatOverride] = useState("");
  const [awayToleranceOverride, setAwayToleranceOverride] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [seededId, setSeededId] = useState<string | null>(null);
  if (airHandler && airHandler.id !== seededId) {
    setSeededId(airHandler.id);
    setName(airHandler.name);
    setTonnageTons(
      airHandler.config.tonnage_tons !== undefined
        ? String(airHandler.config.tonnage_tons)
        : "",
    );
    setAwayCoolOverride(
      airHandler.config.away_setpoint_cool_override !== undefined
        ? toDisplayAbsolute(
            asAbsoluteTemp(airHandler.config.away_setpoint_cool_override),
            temperatureUnit,
          ).toFixed(1)
        : "",
    );
    setAwayHeatOverride(
      airHandler.config.away_setpoint_heat_override !== undefined
        ? toDisplayAbsolute(
            asAbsoluteTemp(airHandler.config.away_setpoint_heat_override),
            temperatureUnit,
          ).toFixed(1)
        : "",
    );
    setAwayToleranceOverride(
      airHandler.config.away_tolerance_override !== undefined
        ? toDisplayDelta(
            asTempDelta(airHandler.config.away_tolerance_override),
            temperatureUnit,
          ).toFixed(1)
        : "",
    );
    setFlairZoneId(airHandler.flairZoneId ?? "");
    setActive(airHandler.active);
  }

  const handleSave = useCallback(async () => {
    if (!airHandler || !name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await updateAirHandler(airHandler.id, {
        name: name.trim(),
        flair_zone_id: flairZoneId.trim() || null,
        active,
        config: {
          ...(tonnageTons.trim() ? { tonnage_tons: Number(tonnageTons) } : {}),
          // Explicit null (not an omitted key) when blank — genuinePartial
          // treats a real null as "clear back to the global value," while
          // an omitted key would leave whatever was already stored
          // untouched. See airHandlerConfig.ts's own comment.
          away_setpoint_cool_override: awayCoolOverride.trim()
            ? fromDisplayAbsolute(Number(awayCoolOverride), temperatureUnit)
            : null,
          away_setpoint_heat_override: awayHeatOverride.trim()
            ? fromDisplayAbsolute(Number(awayHeatOverride), temperatureUnit)
            : null,
          away_tolerance_override: awayToleranceOverride.trim()
            ? fromDisplayDelta(Number(awayToleranceOverride), temperatureUnit)
            : null,
        },
      });
      showNotification(`"${name.trim()}" updated.`, "success");
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
    active,
    airHandler,
    awayCoolOverride,
    awayHeatOverride,
    awayToleranceOverride,
    flairZoneId,
    name,
    onClose,
    onSaved,
    showNotification,
    temperatureUnit,
    tonnageTons,
  ]);

  const handleDelete = useCallback(async () => {
    if (!airHandler) return;
    setSubmitting(true);
    setDeleteError(null);
    try {
      await deleteAirHandler(airHandler.id);
      showNotification(`"${airHandler.name}" deleted.`, "success");
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
  }, [airHandler, onClose, onDeleted, showNotification]);

  if (!airHandler) return null;

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>{airHandler.name} — configuration</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <TextField
              label="Tonnage (tons)"
              type="number"
              value={tonnageTons}
              onChange={(e) => setTonnageTons(e.target.value)}
              helperText="Required before this handler can be activated — the pressure safeguard's baseline."
            />
            <FlairZoneSelect
              value={flairZoneId}
              onChange={setFlairZoneId}
              currentAirHandlerId={airHandler.id}
            />
            <TextField
              label={`Away cooling setpoint override, °${temperatureUnit} (blank = use System Parameters)`}
              type="number"
              value={awayCoolOverride}
              onChange={(e) => setAwayCoolOverride(e.target.value)}
            />
            <TextField
              label={`Away heating setpoint override, °${temperatureUnit} (blank = use System Parameters)`}
              type="number"
              value={awayHeatOverride}
              onChange={(e) => setAwayHeatOverride(e.target.value)}
            />
            <TextField
              label={`Away tolerance override, °${temperatureUnit} (blank = use System Parameters)`}
              type="number"
              value={awayToleranceOverride}
              onChange={(e) => setAwayToleranceOverride(e.target.value)}
              helperText="Applies only while this handler's zones are away (Ecobee-reported or native) — overrides the global Away Mode setpoints/tolerance for this handler only."
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={active}
                  onChange={(e) => setActive(e.target.checked)}
                />
              }
              label="Active"
            />
            {error && (
              <DialogContentText color="error">{error}</DialogContentText>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ justifyContent: "space-between", px: 3 }}>
          <Button
            color="error"
            disabled={!canDelete}
            onClick={() => setConfirmDeleteOpen(true)}
          >
            Delete
          </Button>
          <Stack direction="row" spacing={1}>
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              disabled={!name.trim() || submitting || !canEdit}
              onClick={handleSave}
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
        <DialogTitle>Delete "{airHandler.name}"?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This can't be undone. Deletion is refused if any zone still belongs
            to this air handler — move or delete those zones first.
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
            disabled={submitting || !canDelete}
            onClick={handleDelete}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
