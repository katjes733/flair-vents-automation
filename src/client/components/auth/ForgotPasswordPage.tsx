import { useState, type FormEvent } from "react";
import { useNavigate, Link as RouterLink } from "react-router";
import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import Box from "@mui/material/Box";
import { forgotPassword, resetPassword } from "~/client/api/authApi";
import { extractErrorMessage } from "~/client/api/errorMessage";

type Step = "email" | "reset";

// Two steps in one component, mirroring SignupPage.tsx's own multi-step
// shape rather than AcceptInvitePage.tsx's single-step one — unlike an
// invite (which arrives with the email already known, via the invite
// link), a password reset has a real "request" step first, since nobody
// has emailed this user yet.
export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resent, setResent] = useState(false);

  const handleRequestCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await forgotPassword(email);
      setStep("reset");
    } catch (err) {
      setError(
        extractErrorMessage(err) ?? "Couldn't send a reset code — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    setError(null);
    setResent(false);
    try {
      await forgotPassword(email);
      setResent(true);
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't resend the code.");
    }
  };

  const handleResetPassword = async (e: FormEvent) => {
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
      await resetPassword({ email, code, newPassword: password });
      navigate("/login", {
        replace: true,
        state: { resetSuccess: true },
      });
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "Couldn't reset your password — check the code and try again.",
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
            Reset your password
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

          {step === "email" && (
            <Box component="form" onSubmit={handleRequestCode}>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Enter your account's email and we'll send you a code to reset
                  your password.
                </Typography>
                <TextField
                  label="Email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  fullWidth
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={submitting}
                  fullWidth
                >
                  {submitting ? "Sending…" : "Send reset code"}
                </Button>
                <Typography variant="body2" sx={{ textAlign: "center" }}>
                  <Link component={RouterLink} to="/login">
                    Back to log in
                  </Link>
                </Typography>
              </Stack>
            </Box>
          )}

          {step === "reset" && (
            <Box component="form" onSubmit={handleResetPassword}>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  If an account exists for {email}, we've sent it a reset code.
                </Typography>
                <TextField
                  label="Reset code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  fullWidth
                />
                <TextField
                  label="New password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  helperText="At least 8 characters."
                  required
                  fullWidth
                />
                <TextField
                  label="Confirm new password"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  fullWidth
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={submitting}
                  fullWidth
                >
                  {submitting ? "Resetting…" : "Reset password"}
                </Button>
                <Button size="small" onClick={handleResendCode}>
                  Resend code
                </Button>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
