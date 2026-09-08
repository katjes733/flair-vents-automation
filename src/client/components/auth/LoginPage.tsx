import { useState, type FormEvent } from "react";
import { useNavigate, useLocation, Link as RouterLink } from "react-router";
import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Link from "@mui/material/Link";
import Box from "@mui/material/Box";
import KeyIcon from "@mui/icons-material/Key";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { login } from "~/client/api/sessionApi";
import { loginWithPasskey } from "~/client/api/webauthnApi";
import { useSession } from "~/client/session/useSession";
import { extractErrorMessage } from "~/client/api/errorMessage";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const resetSuccess = Boolean(
    (location.state as { resetSuccess?: boolean } | null)?.resetSuccess,
  );

  const goInAfterLogin = async () => {
    await refresh();
    const from = (location.state as { from?: { pathname: string } } | null)
      ?.from;
    navigate(from?.pathname ?? "/", { replace: true });
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      await goInAfterLogin();
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "Login failed — check your email and password.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError(null);
    setPasskeySubmitting(true);
    try {
      await loginWithPasskey();
      await goInAfterLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Passkey sign-in failed.");
    } finally {
      setPasskeySubmitting(false);
    }
  };

  return (
    <Container maxWidth="xs" sx={{ px: 2 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
            Log in
          </Typography>
          {resetSuccess && !error && (
            <Alert severity="success" sx={{ mb: 2 }}>
              Password reset. Log in with your new password.
            </Alert>
          )}
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2}>
              <TextField
                label="Email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                fullWidth
              />
              <TextField
                label="Password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                fullWidth
              />
              <Link
                component={RouterLink}
                to="/forgot-password"
                variant="body2"
                sx={{ alignSelf: "flex-end" }}
              >
                Forgot password?
              </Link>
              <Button
                type="submit"
                variant="contained"
                disabled={submitting}
                fullWidth
              >
                {submitting ? "Logging in…" : "Log in"}
              </Button>
            </Stack>
          </Box>
          {browserSupportsWebAuthn() && (
            <>
              <Divider sx={{ my: 2 }}>or</Divider>
              <Button
                variant="outlined"
                startIcon={<KeyIcon />}
                fullWidth
                disabled={passkeySubmitting}
                onClick={handlePasskeyLogin}
              >
                {passkeySubmitting
                  ? "Waiting for passkey…"
                  : "Sign in with a passkey"}
              </Button>
            </>
          )}
          <Typography variant="body2" sx={{ mt: 2, textAlign: "center" }}>
            Don't have an account?{" "}
            <Link component={RouterLink} to="/signup">
              Sign up
            </Link>
          </Typography>
        </CardContent>
      </Card>
    </Container>
  );
}
