import { useState } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import { useThemeMode } from "~/client/theme/useThemeMode";
import { useDiagnosticMode } from "~/client/theme/useDiagnosticMode";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import { getStoredActor, setStoredActor } from "~/client/api/controlApi";
import { useNotification } from "~/client/components/notification/useNotification";
import { AIRFLOW_UNIT_LABELS, type AirflowUnit } from "~/shared/types/airflow";
import type { TemperatureUnit } from "~/shared/types/temperature";

const AIRFLOW_UNITS: AirflowUnit[] = ["Lps", "CFM", "M3h"];

// Per-browser display/appearance preferences — distinct from the much
// larger, DB-backed Phase 2 SystemParameters page (dozens of control-loop
// tunables like spike thresholds and pressure caps). Everything here is
// either a localStorage-persisted per-browser choice (temperature/airflow
// unit, theme mode, Diagnostic Mode, display name) or, for the two display
// units, defaults from the system-wide setting until a browser explicitly
// overrides it. See "Temperature units" / the Settings page section of the
// implementation plan.
export default function SettingsPage() {
  const { mode, toggle: toggleThemeMode } = useThemeMode();
  const { diagnosticMode, toggle: toggleDiagnosticMode } = useDiagnosticMode();
  const {
    temperatureUnit,
    setTemperatureUnit,
    isTemperatureUnitOverridden,
    airflowUnit,
    setAirflowUnit,
    isAirflowUnitOverridden,
  } = useDisplayUnit();
  const { showNotification } = useNotification();
  const [actor, setActor] = useState(getStoredActor);

  const handleSaveActor = () => {
    setStoredActor(actor.trim());
    showNotification("Display name saved.", "success");
  };

  return (
    <Container maxWidth="sm" sx={{ px: 2 }}>
      <Typography variant="h5" fontWeight={600} sx={{ mb: 2 }}>
        Settings
      </Typography>
      <Stack spacing={2}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>
              Display units
            </Typography>
            <Stack spacing={2}>
              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 0.5 }}
                >
                  Temperature
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                  }}
                >
                  <ToggleButtonGroup
                    value={temperatureUnit}
                    exclusive
                    size="small"
                    onChange={(_e, next: TemperatureUnit | null) =>
                      next && setTemperatureUnit(next)
                    }
                  >
                    <ToggleButton value="C">°C</ToggleButton>
                    <ToggleButton value="F">°F</ToggleButton>
                  </ToggleButtonGroup>
                  {isTemperatureUnitOverridden && (
                    <Button
                      size="small"
                      onClick={() => setTemperatureUnit(null)}
                    >
                      Use system default
                    </Button>
                  )}
                </Box>
              </Box>

              <Box>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 0.5 }}
                >
                  Airflow
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    flexWrap: "wrap",
                  }}
                >
                  <TextField
                    select
                    size="small"
                    value={airflowUnit}
                    onChange={(e) =>
                      setAirflowUnit(e.target.value as AirflowUnit)
                    }
                    sx={{ minWidth: 120 }}
                  >
                    {AIRFLOW_UNITS.map((unit) => (
                      <MenuItem key={unit} value={unit}>
                        {AIRFLOW_UNIT_LABELS[unit]}
                      </MenuItem>
                    ))}
                  </TextField>
                  {isAirflowUnitOverridden && (
                    <Button size="small" onClick={() => setAirflowUnit(null)}>
                      Use system default
                    </Button>
                  )}
                </Box>
              </Box>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
              Appearance
            </Typography>
            <Stack spacing={1}>
              <FormControlLabel
                control={
                  <Switch
                    checked={mode === "dark"}
                    onChange={toggleThemeMode}
                  />
                }
                label="Dark mode"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={diagnosticMode}
                    onChange={toggleDiagnosticMode}
                  />
                }
                label="Diagnostic Mode"
              />
              <Typography variant="caption" color="text.secondary">
                Shows extra per-zone diagnostic fields across the dashboard (raw
                sensor readings, reconciliation history, and similar).
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
              Your display name
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 1.5 }}
            >
              Recorded on manual overrides and control disarm/rearm actions, so
              it's clear who did what.
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                fullWidth
                value={actor}
                onChange={(e) => setActor(e.target.value)}
              />
              <Button
                variant="contained"
                disabled={actor.trim() === getStoredActor()}
                onClick={handleSaveActor}
              >
                Save
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Container>
  );
}
