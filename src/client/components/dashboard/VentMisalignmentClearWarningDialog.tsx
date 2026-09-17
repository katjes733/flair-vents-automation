import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import { clearVentMisalignmentWarning } from "~/client/api/zonesApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";

interface VentMisalignmentClearWarningDialogProps {
  open: boolean;
  zoneId: string;
  zoneName: string;
  onClose: () => void;
  onCleared: () => void;
}

export default function VentMisalignmentClearWarningDialog({
  open,
  zoneId,
  zoneName,
  onClose,
  onCleared,
}: VentMisalignmentClearWarningDialogProps) {
  const { showNotification } = useNotification();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await clearVentMisalignmentWarning(zoneId);
      showNotification(`Cleared the vent warning for ${zoneName}.`, "success");
      onCleared();
      onClose();
    } catch (err) {
      setError(
        extractErrorMessage(err) ?? "Couldn't clear the warning — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Clear {zoneName}'s vent warning?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          This resets the zone's recalibration history. It doesn't change
          anything about the vent itself — only clear this once you've
          physically addressed the vent (or confirmed the room is holding its
          temperature normally again), since it takes a fresh run of repeated
          recalibrations to flag it again.
        </DialogContentText>
        {error && (
          <DialogContentText color="error" sx={{ mt: 1 }}>
            {error}
          </DialogContentText>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={submitting}
          onClick={handleSubmit}
        >
          Clear warning
        </Button>
      </DialogActions>
    </Dialog>
  );
}
