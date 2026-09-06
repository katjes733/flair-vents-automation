import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams, Link as RouterLink } from "react-router";
import Container from "@mui/material/Container";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Stepper from "@mui/material/Stepper";
import Step from "@mui/material/Step";
import StepLabel from "@mui/material/StepLabel";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Link from "@mui/material/Link";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import {
  sendCode,
  verifyCode,
  signup,
  connectFlair,
} from "~/client/api/authApi";
import { useSession } from "~/client/session/useSession";
import { extractErrorMessage } from "~/client/api/errorMessage";

type SignupStep = "email" | "code" | "password" | "connect-flair";

const STEP_ORDER: SignupStep[] = ["email", "code", "password", "connect-flair"];
const STEP_LABELS: Record<SignupStep, string> = {
  email: "Email",
  code: "Verify",
  password: "Password",
  "connect-flair": "Connect Flair",
};

export default function SignupPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: sessionLoading, refresh } = useSession();

  const paramEmail = searchParams.get("email");
  const [step, setStep] = useState<SignupStep>(paramEmail ? "code" : "email");
  const [email, setEmail] = useState(paramEmail ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [flairClientId, setFlairClientId] = useState("");
  const [flairClientSecret, setFlairClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Resume mid-signup: a real session already exists (password verified,
  // via /session/login's own pending-signup fallback) but no installation
  // yet — skip straight to the one remaining step, rather than making them
  // redo email verification and password entry.
  useEffect(() => {
    if (!sessionLoading && user && !user.installationLinked) {
      setEmail(user.loginEmail);
      setStep("connect-flair");
    }
  }, [sessionLoading, user]);

  const handleSendCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await sendCode(email);
      setStep("code");
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "Couldn't send a verification code — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendCode = async () => {
    setError(null);
    try {
      await sendCode(email);
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't resend the code.");
    }
  };

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyCode(email, code);
      setStep("password");
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "That code didn't work — check it and try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleSetPassword = async (e: FormEvent) => {
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
      await signup(email, password);
      setStep("connect-flair");
    } catch (err) {
      setError(
        extractErrorMessage(err) ?? "Couldn't create your account — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConnectFlair = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await connectFlair({ email, flairClientId, flairClientSecret });
      await refresh();
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        extractErrorMessage(err) ??
          "Couldn't connect your Flair account — try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container maxWidth="xs" sx={{ px: 2 }}>
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
            Sign up
          </Typography>
          <Stepper
            activeStep={STEP_ORDER.indexOf(step)}
            alternativeLabel
            sx={{ mb: 3 }}
          >
            {STEP_ORDER.map((s) => (
              <Step key={s}>
                <StepLabel>{STEP_LABELS[s]}</StepLabel>
              </Step>
            ))}
          </Stepper>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          {step === "email" && (
            <Box component="form" onSubmit={handleSendCode}>
              <Stack spacing={2}>
                <TextField
                  label="Email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  fullWidth
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={submitting || !email}
                  fullWidth
                >
                  {submitting ? "Sending…" : "Send verification code"}
                </Button>
                <Typography variant="body2" sx={{ textAlign: "center" }}>
                  Already have an account?{" "}
                  <Link component={RouterLink} to="/login">
                    Log in
                  </Link>
                </Typography>
              </Stack>
            </Box>
          )}

          {step === "code" && (
            <Box component="form" onSubmit={handleVerifyCode}>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  We sent a verification code to {email}.
                </Typography>
                <TextField
                  label="Verification code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  fullWidth
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={submitting || !code}
                  fullWidth
                >
                  {submitting ? "Verifying…" : "Verify code"}
                </Button>
                <Button size="small" onClick={handleResendCode}>
                  Resend code
                </Button>
              </Stack>
            </Box>
          )}

          {step === "password" && (
            <Box component="form" onSubmit={handleSetPassword}>
              <Stack spacing={2}>
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
                  disabled={submitting || !password || !confirmPassword}
                  fullWidth
                >
                  {submitting ? "Creating account…" : "Continue"}
                </Button>
              </Stack>
            </Box>
          )}

          {step === "connect-flair" && (
            <Box component="form" onSubmit={handleConnectFlair}>
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Connect your Flair account so this app can see and control
                  your vents:
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  component="ol"
                  sx={{ pl: 2.5, m: 0 }}
                >
                  <li>
                    Open the Flair app (or app.flair.co) and sign in to the{" "}
                    <strong>same Flair account</strong> that controls your
                    vents.
                  </li>
                  <li>
                    Go to <strong>Account Settings → Developer Settings</strong>
                    .
                  </li>
                  <li>
                    Generate a Client ID and Client Secret — this is generated
                    per Flair account, not per app, so your home gets its own
                    pair.
                  </li>
                  <li>Copy both values and paste them below.</li>
                </Typography>
                <TextField
                  label="Flair Client ID"
                  value={flairClientId}
                  onChange={(e) => setFlairClientId(e.target.value)}
                  fullWidth
                />
                <TextField
                  label="Flair Client Secret"
                  type={showSecret ? "text" : "password"}
                  value={flairClientSecret}
                  onChange={(e) => setFlairClientSecret(e.target.value)}
                  fullWidth
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            aria-label={
                              showSecret ? "Hide secret" : "Show secret"
                            }
                            onClick={() => setShowSecret((prev) => !prev)}
                            edge="end"
                          >
                            {showSecret ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={submitting || !flairClientId || !flairClientSecret}
                  fullWidth
                >
                  {submitting ? "Connecting…" : "Connect Flair account"}
                </Button>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
