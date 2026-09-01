import { useCallback, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { createOverride, type HoldType } from "~/client/api/overridesApi";
import { getStoredActor, setStoredActor } from "~/client/api/controlApi";
import { useNotification } from "~/client/components/notification/useNotification";

const HOLD_TYPE_LABELS: Record<HoldType, string> = {
  "2h": "2 hours",
  "4h": "4 hours",
  until_next_event: "Until next scheduled event",
  permanent: "Permanent (until manually cleared)",
};

interface ZoneOverrideDialogProps {
  open: boolean;
  zoneId: string;
  zoneName: string;
  onClose: () => void;
  onCreated: () => void;
}

export default function ZoneOverrideDialog({
  open,
  zoneId,
  zoneName,
  onClose,
  onCreated,
}: ZoneOverrideDialogProps) {
  const { showNotification } = useNotification();
  const [kind, setKind] = useState<"setpoint" | "position">("position");
  const [value, setValue] = useState("");
  const [holdType, setHoldType] = useState<HoldType>("2h");
  const [actor, setActor] = useState(getStoredActor);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    const numericValue = Number(value);
    if (!actor.trim() || Number.isNaN(numericValue)) return;
    setStoredActor(actor.trim());
    setSubmitting(true);
    try {
      await createOverride({
        kind,
        zone_id: zoneId,
        value: numericValue,
        hold_type: holdType,
        actor: actor.trim(),
      });
      showNotification(`Manual override set for ${zoneName}.`, "success");
      onCreated();
      onClose();
    } catch {
      showNotification("Couldn't set the override — try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }, [
    actor,
    holdType,
    kind,
    onClose,
    onCreated,
    showNotification,
    value,
    zoneId,
    zoneName,
  ]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Manual override — {zoneName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <ToggleButtonGroup
            value={kind}
            exclusive
            onChange={(_e, next) => next && setKind(next)}
            fullWidth
            size="small"
          >
            <ToggleButton value="position">Vent position</ToggleButton>
            <ToggleButton value="setpoint">Setpoint</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            label={kind === "position" ? "Position (0–100%)" : "Setpoint (°C)"}
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            slotProps={
              kind === "position"
                ? { htmlInput: { min: 0, max: 100 } }
                : undefined
            }
          />
          <TextField
            select
            label="Hold until"
            value={holdType}
            onChange={(e) => setHoldType(e.target.value as HoldType)}
          >
            {Object.entries(HOLD_TYPE_LABELS).map(([type, label]) => (
              <MenuItem key={type} value={type}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Your name"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            helperText="Recorded so it's clear who set this."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!actor.trim() || value === "" || submitting}
          onClick={handleSubmit}
        >
          Set override
        </Button>
      </DialogActions>
    </Dialog>
  );
}
