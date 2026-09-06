import { useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Divider from "@mui/material/Divider";
import { useSession } from "~/client/session/useSession";
import { deleteAccount } from "~/client/api/accountApi";
import { extractErrorMessage } from "~/client/api/errorMessage";

// Two account-lifecycle actions grouped in one card, the way GlobalStatusBar
// nests its own disarm confirmation and EditAirHandlerDialog nests its own
// delete confirmation — a real, easy-to-regret action gets its own
// in-place confirm dialog rather than firing on a single click.
export default function AccountDangerZoneCard() {
  const { logoutEverywhere } = useSession();

  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleLogoutEverywhere = async () => {
    setLoggingOut(true);
    try {
      await logoutEverywhere();
    } finally {
      setLoggingOut(false);
    }
  };

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount(password);
      // The server has already destroyed every session, including this
      // one — a plain hard navigation (not useSession's logout(), which
      // would make a now-pointless call to /session/logout) is enough to
      // land back on /login.
      window.location.assign("/login");
    } catch (err) {
      setDeleteError(
        extractErrorMessage(err) ?? "Couldn't delete your account.",
      );
      setDeleting(false);
    }
  };

  return (
    <>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
            Account
          </Typography>
          <Stack spacing={1.5}>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="body2" color="text.secondary">
                Signed in on another device, or think a session might not be
                yours anymore?
              </Typography>
              <Button
                size="small"
                onClick={() => setLogoutConfirmOpen(true)}
                sx={{ flexShrink: 0 }}
              >
                Log out everywhere
              </Button>
            </Stack>
            <Divider />
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="body2" color="text.secondary">
                Permanently delete your account. This can't be undone.
              </Typography>
              <Button
                size="small"
                color="error"
                onClick={() => setDeleteConfirmOpen(true)}
                sx={{ flexShrink: 0 }}
              >
                Delete account
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      <Dialog
        open={logoutConfirmOpen}
        onClose={() => setLogoutConfirmOpen(false)}
      >
        <DialogTitle>Log out everywhere?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This signs you out of every device, including this one — you'll need
            to log in again here too.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLogoutConfirmOpen(false)}>Cancel</Button>
          <Button
            color="warning"
            variant="contained"
            disabled={loggingOut}
            onClick={handleLogoutEverywhere}
          >
            Log out everywhere
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false);
          setPassword("");
          setDeleteError(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete your account?</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This permanently deletes your account and every passkey on it. It
            doesn't delete any installation you belong to — if you're the only
            owner of one, this is refused until you promote another member to
            owner or delete that installation first.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            type="password"
            label="Confirm your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {deleteError && (
            <DialogContentText color="error" sx={{ mt: 1 }}>
              {deleteError}
            </DialogContentText>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setDeleteConfirmOpen(false);
              setPassword("");
              setDeleteError(null);
            }}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!password || deleting}
            onClick={handleDeleteAccount}
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
