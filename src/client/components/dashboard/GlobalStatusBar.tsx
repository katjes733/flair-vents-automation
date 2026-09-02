import { useCallback, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import {
  disarmControl,
  rearmControl,
  getStoredActor,
  setStoredActor,
} from "~/client/api/controlApi";
import { useNotification } from "~/client/components/notification/useNotification";

interface GlobalStatusBarProps {
  controlDisarmed: boolean;
  onChanged: () => void;
  // Rendered on the right of the one status row — the toolbar's "Add air
  // handler"/"Add zone" actions, per the user's own request to reclaim the
  // vertical space a separate toolbar row cost.
  children?: React.ReactNode;
}

/**
 * The prominent, always-visible disarm control — deliberately here, not
 * buried in a settings page, since the motivating scenario is "get
 * everything safe, right now, without navigating." See "Manual disarm" in
 * the implementation plan. One row, a 3-column grid (`1fr auto 1fr`) so
 * the middle column stays genuinely centered regardless of how wide the
 * two side columns' own content is: the disarm/resume button flush left,
 * the status pill (+ its explanatory text when disarmed) centered in the
 * middle, and the toolbar actions passed in as `children` flush right.
 */
export default function GlobalStatusBar({
  controlDisarmed,
  onChanged,
  children,
}: GlobalStatusBarProps) {
  const { showNotification } = useNotification();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actor, setActor] = useState(getStoredActor);
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = useCallback(async () => {
    if (!actor.trim()) return;
    setStoredActor(actor.trim());
    setSubmitting(true);
    try {
      if (controlDisarmed) {
        await rearmControl(actor.trim());
        showNotification("Automatic control resumed.", "success");
      } else {
        await disarmControl(actor.trim());
        showNotification(
          "Control disarmed — vents held at idle baseline.",
          "warning",
        );
      }
      onChanged();
      setConfirmOpen(false);
    } catch {
      showNotification("That didn't go through — try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }, [actor, controlDisarmed, onChanged, showNotification]);

  return (
    <>
      <Paper
        elevation={controlDisarmed ? 6 : 0}
        sx={{
          p: 2,
          mb: 2,
          bgcolor: controlDisarmed ? "warning.main" : "background.paper",
          color: controlDisarmed ? "warning.contrastText" : "text.primary",
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "1fr auto 1fr",
            alignItems: "center",
            gap: 2,
          }}
        >
          <Box sx={{ justifySelf: "start" }}>
            <Button
              variant={controlDisarmed ? "contained" : "outlined"}
              color={controlDisarmed ? "inherit" : "error"}
              size="small"
              onClick={() => setConfirmOpen(true)}
            >
              {controlDisarmed ? "Resume Automatic Control" : "Disarm Control"}
            </Button>
          </Box>
          <Box
            sx={{
              justifySelf: "center",
              display: "flex",
              alignItems: "center",
              gap: 1.5,
            }}
          >
            {controlDisarmed ? (
              <Chip label="Control Disarmed" color="default" size="small" />
            ) : (
              <Chip
                label="Automatic Control Active"
                color="success"
                size="small"
              />
            )}
            {controlDisarmed && (
              <Typography variant="body2">
                Every vent is holding its idle baseline instead of being
                actively controlled.
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              justifySelf: "end",
              display: "flex",
              gap: 1,
            }}
          >
            {children}
          </Box>
        </Box>
      </Paper>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>
          {controlDisarmed ? "Resume automatic control?" : "Disarm control?"}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {controlDisarmed
              ? "This resumes automatic vent/setpoint control on the next tick."
              : "Every smart vent will be dispatched to its idle baseline immediately, and the setpoint push will be suppressed until you resume."}
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            label="Your name"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            helperText="Recorded so it's clear who made this change."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button
            onClick={handleConfirm}
            disabled={!actor.trim() || submitting}
            color={controlDisarmed ? "primary" : "error"}
            variant="contained"
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
