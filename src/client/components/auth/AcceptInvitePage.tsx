import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import { sendCode, activateInvite } from "~/client/api/authApi";
import { useSession } from "~/client/session/useSession";
import { extractErrorMessage } from "~/client/api/errorMessage";

// Reached via the link in an invite email (?email=...) — a single-step
// activation (verification code + new password together), unlike
// self-signup's multi-step wizard: there's no "connect Flair" step to
// sequence afterward, since the installation this invite belongs to
// already has Flair connected.
export default function AcceptInvitePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh } = useSession();
  const email = searchParams.get("email");

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);

  if (!email) {
    return (
      <Container maxWidth="xs" sx={{ px: 2 }}>
        <Card variant="outlined">
          <CardContent>
            <Alert severity="error">
              This invite link is missing its email address. Ask whoever invited
              you to resend it.
            </Alert>
          </CardContent>
        </Card>
      </Container>
    );
  }

  const handleResendCode = async () => {
    setError(null);
    setResent(false);
    try {
      await sendCode(email);
      setResent(true);
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't resend the code.");
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await activateInvite({ email, code, password });
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "Couldn't activate your invite — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container maxWidth="xs" sx={{ px: 2 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h5" fontWeight={600} sx={{ mb: 1 }}>
            Accept your invite
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Enter the verification code sent to {email} and choose a password.
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {resent && !error && (
            <Alert severity="success" sx={{ mb: 2 }}>
              A new code has been sent.
            </Alert>
          )}
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label="Verification code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                fullWidth
              />
              <TextField
                label="Password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helperText="At least 8 characters."
                fullWidth
              />
              <TextField
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                fullWidth
              />
              <Button
                type="submit"
                variant="contained"
                disabled={submitting || !code || !password || !confirmPassword}
                fullWidth
              >
                {submitting ? "Activating…" : "Activate account"}
              </Button>
              <Button size="small" onClick={handleResendCode}>
                Resend code
              </Button>
            </Stack>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}
