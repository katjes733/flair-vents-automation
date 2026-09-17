import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import { triggerVentRecalibration } from "~/client/api/zonesApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";

interface VentRecalibrationTriggerDialogProps {
  open: boolean;
  zoneId: string;
  zoneName: string;
  // Whether this zone is *currently* flagged chronic — when it isn't,
  // this is a deliberate maintenance check, not a response to an active
  // warning, and the dialog says so explicitly so a person can't trigger
  // it by mistake without realizing that's what they're doing.
  zoneChronic: boolean;
  onClose: () => void;
  onTriggered: () => void;
}

export default function VentRecalibrationTriggerDialog({
  open,
  zoneId,
  zoneName,
  zoneChronic,
  onClose,
  onTriggered,
}: VentRecalibrationTriggerDialogProps) {
  const { showNotification } = useNotification();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await triggerVentRecalibration(zoneId);
      showNotification(
        `Recalibration requested for ${zoneName} — usually resolves within a couple of minutes.`,
        "success",
      );
      onTriggered();
      onClose();
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "Couldn't request a recalibration — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Unstick {zoneName}'s vent?</DialogTitle>
      <DialogContent>
        <DialogContentText>
          This fully opens the vent, then recloses it back to its normal target
          once it reports open — usually within a couple of minutes.
        </DialogContentText>
        <DialogContentText sx={{ mt: 1 }}>
          It only confirms the vent's motor responds — it does not by itself
          prove the room stops overcooling. Watch the room's temperature over
          the next hour to confirm the underlying issue is actually resolved.
        </DialogContentText>
        {!zoneChronic && (
          <DialogContentText sx={{ mt: 1 }} color="warning.main">
            This zone isn't currently flagged as having a recurring issue —
            you're about to force-cycle it anyway.
          </DialogContentText>
        )}
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
          Unstick vent
        </Button>
      </DialogActions>
    </Dialog>
  );
}
