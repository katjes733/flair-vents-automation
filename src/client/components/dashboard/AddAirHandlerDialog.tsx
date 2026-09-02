import { useCallback, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Stack from "@mui/material/Stack";
import { createAirHandler } from "~/client/api/airHandlersApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";
import FlairZoneSelect from "~/client/components/shared/FlairZoneSelect";

interface AddAirHandlerDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * A pragmatic pull-forward from Phase 2's full AirHandlerSettings page
 * (topology mode, pressure caps, the square-footage tonnage helper) — just
 * enough fields to get a real air handler into the DB so the rest of
 * Phase 1 (zones, overrides, tick decisions) has something to attach to.
 * tonnage_tons is required before the handler can be set active per
 * Config-time validation — the pressure safeguard's universal baseline.
 */
export default function AddAirHandlerDialog({
  open,
  onClose,
  onCreated,
}: AddAirHandlerDialogProps) {
  const { showNotification } = useNotification();
  const [name, setName] = useState("");
  const [tonnageTons, setTonnageTons] = useState("");
  const [flairZoneId, setFlairZoneId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset every field on the closed→open transition (not just on a
  // successful create) — see the identical comment in AddZoneDialog.tsx,
  // the same bug and fix, found first there.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setName("");
      setTonnageTons("");
      setFlairZoneId("");
      setError(null);
    }
  }

  const handleSubmit = useCallback(async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createAirHandler({
        name: name.trim(),
        flair_zone_id: flairZoneId.trim() || null,
        active: true,
        config: tonnageTons.trim()
          ? { tonnage_tons: Number(tonnageTons) }
          : undefined,
      });
      showNotification(`"${name.trim()}" created.`, "success");
      onCreated();
      onClose();
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "Couldn't create the air handler — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }, [flairZoneId, name, onClose, onCreated, showNotification, tonnageTons]);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add air handler</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          Full topology/pressure-cap configuration comes later (Phase 2) — this
          just gets it into the system so zones have something to attach to.
        </DialogContentText>
        <Stack spacing={2}>
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
          <FlairZoneSelect value={flairZoneId} onChange={setFlairZoneId} />
          {error && (
            <DialogContentText color="error">{error}</DialogContentText>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!name.trim() || submitting}
          onClick={handleSubmit}
        >
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
