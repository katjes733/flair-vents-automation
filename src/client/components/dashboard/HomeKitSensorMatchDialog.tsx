import { useCallback, useEffect, useMemo, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import {
  fetchHomeKitStatus,
  fetchHomeKitSensorMatches,
  type HomeKitStatus,
  type SensorMatchEntry,
} from "~/client/api/homekitApi";
import { fetchZones, updateZone, type Zone } from "~/client/api/zonesApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";
import { useCanWrite } from "~/client/permissions/usePermission";

interface HomeKitSensorMatchDialogProps {
  open: boolean;
  airHandlerId: string;
  airHandlerName: string;
  onClose: () => void;
  // Called after any mapping change — a parent that surfaces this dialog
  // as a post-sync call to action (see "Sync with Flair") can use this to
  // refresh its own zone list, without this dialog needing to know why.
  onMatched?: () => void;
}

function suggestedZoneIdFor(entry: SensorMatchEntry): string {
  return entry.kind === "unmapped_suggested" ? entry.suggestedZoneId : "";
}

/**
 * "Ecobee SmartSensor Reading via HomeKit" — the one-time, human-confirmed
 * step that links a zone to the local HomeKit SmartSensor accessory it
 * should read its live temperature/occupancy from, in place of Flair's
 * own relayed room reading. Never fully automatic — a suggested match
 * still requires an explicit confirm click, per the real "Extra Den"
 * mismatch this design exists to prevent (see the plan's own doc). Mirrors
 * HomeKitPairingDialog.tsx's own skeleton (load-on-open, wasOpen reset,
 * canEdit gating), and SyncZonesDialog's own "suggested vs. new" rendering
 * shape for the unmapped case.
 */
export default function HomeKitSensorMatchDialog({
  open,
  airHandlerId,
  airHandlerName,
  onClose,
  onMatched,
}: HomeKitSensorMatchDialogProps) {
  const { showNotification } = useNotification();
  const canEdit = useCanWrite("dashboard.airHandler.edit");
  const [status, setStatus] = useState<HomeKitStatus | null>(null);
  const [matches, setMatches] = useState<SensorMatchEntry[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoneSelectionBySerial, setZoneSelectionBySerial] = useState<
    Record<string, string>
  >({});

  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setWasOpen(true);
    setMatches([]);
    setZones([]);
    setZoneSelectionBySerial({});
    setError(null);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusResult, matchesResult, allZones] = await Promise.all([
        fetchHomeKitStatus(airHandlerId),
        fetchHomeKitSensorMatches(airHandlerId),
        fetchZones(),
      ]);
      setStatus(statusResult);
      setMatches(matchesResult);
      setZones(allZones.filter((z) => z.airHandlerId === airHandlerId));
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't load HomeKit sensors.");
    } finally {
      setLoading(false);
    }
  }, [airHandlerId]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleConfirm = useCallback(
    async (serial: string, zoneId: string) => {
      if (!zoneId) return;
      setSaving(true);
      setError(null);
      try {
        await updateZone(zoneId, {
          config: { homekit_sensor_serial: serial },
        });
        showNotification("SmartSensor mapping confirmed.", "success");
        await load();
        onMatched?.();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't save the mapping.");
      } finally {
        setSaving(false);
      }
    },
    [load, onMatched, showNotification],
  );

  const handleUnmap = useCallback(
    async (zoneId: string) => {
      setSaving(true);
      setError(null);
      try {
        await updateZone(zoneId, { config: { homekit_sensor_serial: null } });
        showNotification("SmartSensor mapping removed.", "success");
        await load();
        onMatched?.();
      } catch (err) {
        setError(extractErrorMessage(err) ?? "Couldn't remove the mapping.");
      } finally {
        setSaving(false);
      }
    },
    [load, onMatched, showNotification],
  );

  const rows = useMemo(
    () =>
      matches.map((m) => ({
        entry: m,
        selectedZoneId:
          zoneSelectionBySerial[m.serial] ?? suggestedZoneIdFor(m),
      })),
    [matches, zoneSelectionBySerial],
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Match HomeKit sensors — {airHandlerName}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {loading ? (
            <CircularProgress size={24} />
          ) : status && !status.paired ? (
            <DialogContentText>
              Not paired with HomeKit yet — set up a pairing for this air
              handler first (see "Set up HomeKit pairing" above), then come back
              here to match its SmartSensors.
            </DialogContentText>
          ) : matches.length === 0 ? (
            <DialogContentText>
              No SmartSensor accessories found under this pairing.
            </DialogContentText>
          ) : (
            rows.map(({ entry, selectedZoneId }) => (
              <Paper key={entry.serial} variant="outlined" sx={{ p: 2 }}>
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="subtitle2">
                      {entry.name || "(unnamed sensor)"}
                    </Typography>
                    <Chip size="small" label={`Serial ${entry.serial}`} />
                    {entry.kind === "unmapped_suggested" && (
                      <Chip
                        size="small"
                        color="info"
                        label="Suggested match found"
                      />
                    )}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    {entry.tempC != null
                      ? `${entry.tempC.toFixed(1)}°C`
                      : "no reading"}
                    {entry.occupied != null
                      ? `, ${entry.occupied ? "occupied" : "unoccupied"}`
                      : ""}
                  </Typography>
                  {entry.kind === "already_mapped" ? (
                    <>
                      <Typography variant="body2">
                        Mapped to <strong>{entry.zoneName}</strong>
                      </Typography>
                      <Button
                        size="small"
                        color="error"
                        disabled={saving || !canEdit}
                        onClick={() => handleUnmap(entry.zoneId)}
                        sx={{ alignSelf: "flex-start" }}
                      >
                        Unmap
                      </Button>
                    </>
                  ) : (
                    <Stack direction="row" spacing={1}>
                      <TextField
                        select
                        size="small"
                        label="Map to zone"
                        value={selectedZoneId}
                        onChange={(e) =>
                          setZoneSelectionBySerial((prev) => ({
                            ...prev,
                            [entry.serial]: e.target.value,
                          }))
                        }
                        sx={{ minWidth: 200 }}
                      >
                        <MenuItem value="">— select a zone —</MenuItem>
                        {zones.map((z) => (
                          <MenuItem key={z.id} value={z.id}>
                            {z.name}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Button
                        variant="contained"
                        size="small"
                        disabled={saving || !canEdit || !selectedZoneId}
                        onClick={() =>
                          handleConfirm(entry.serial, selectedZoneId)
                        }
                      >
                        Confirm
                      </Button>
                    </Stack>
                  )}
                </Stack>
              </Paper>
            ))
          )}
          {error && (
            <DialogContentText color="error">{error}</DialogContentText>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
