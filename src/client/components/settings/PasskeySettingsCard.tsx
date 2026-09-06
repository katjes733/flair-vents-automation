import { useCallback, useEffect, useState } from "react";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import IconButton from "@mui/material/IconButton";
import DeleteIcon from "@mui/icons-material/Delete";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import {
  fetchPasskeys,
  registerPasskey,
  deletePasskey,
  type PasskeyCredential,
} from "~/client/api/webauthnApi";
import { useNotification } from "~/client/components/notification/useNotification";

// Renders nothing at all on a browser/device with no WebAuthn support —
// there's nothing useful this card could offer there, and showing an
// always-empty "Passkeys" section would just be confusing.
export default function PasskeySettingsCard() {
  // A fixed fact about this browser/device, not something that changes at
  // runtime — computed once so the effect below can skip fetching entirely
  // on a browser that's never going to render this card's list anyway.
  const [supported] = useState(browserSupportsWebAuthn);
  const { showNotification } = useNotification();
  const [passkeys, setPasskeys] = useState<PasskeyCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [registering, setRegistering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPasskeys(await fetchPasskeys());
      setError(null);
    } catch {
      setError("Couldn't load your passkeys.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (supported) load();
  }, [supported, load]);

  const handleAdd = async () => {
    setRegistering(true);
    setError(null);
    try {
      await registerPasskey(nickname.trim() || undefined);
      setNickname("");
      showNotification("Passkey added.", "success");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add a passkey.");
    } finally {
      setRegistering(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deletePasskey(id);
      showNotification("Passkey removed.", "success");
      await load();
    } catch {
      showNotification("Couldn't remove that passkey.", "error");
    }
  };

  if (!supported) return null;

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
          Passkeys
        </Typography>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", mb: 1.5 }}
        >
          Sign in without a password, using your device's own screen lock or
          security key.
        </Typography>
        {error && (
          <Alert severity="error" sx={{ mb: 1.5 }}>
            {error}
          </Alert>
        )}
        {!loading && passkeys.length > 0 && (
          <List dense disablePadding sx={{ mb: 1.5 }}>
            {passkeys.map((p) => (
              <ListItem
                key={p.id}
                disableGutters
                secondaryAction={
                  <IconButton
                    edge="end"
                    aria-label={`Remove ${p.nickname ?? "this passkey"}`}
                    onClick={() => handleDelete(p.id)}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                }
              >
                <ListItemText
                  primary={p.nickname ?? "Unnamed passkey"}
                  secondary={
                    p.lastUsedAt
                      ? `Last used ${new Date(p.lastUsedAt).toLocaleDateString()}`
                      : `Added ${new Date(p.createdAt).toLocaleDateString()}`
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            fullWidth
            label="Nickname (optional)"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          <Button
            variant="contained"
            disabled={registering}
            onClick={handleAdd}
          >
            {registering ? "Adding…" : "Add passkey"}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
