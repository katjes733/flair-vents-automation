import { useCallback, useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import {
  runSync,
  linkRoomToZone,
  createZoneFromRoom,
  type SyncDiffEntry,
  type SyncRunResult,
  type UnmatchedSyncDiffEntry,
} from "~/client/api/syncApi";
import type { Zone } from "~/client/api/zonesApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";

interface SyncZonesDialogProps {
  open: boolean;
  airHandlerId: string;
  // Only this air handler's zones — matches how the server itself scopes
  // both the existing-zone lookup and the name-suggestion match. See
  // "Flair Sync Engine".
  zones: Zone[];
  onClose: () => void;
  onSynced: () => void;
}

const MATCHED_KIND_LABELS: Record<string, string> = {
  matched_unchanged: "already in sync",
  matched_sensor_drift: "sensor flags updated",
  matched_vent_set_changed: "vent set updated",
  matched_retrofit: "retrofitted to smart vent",
  matched_hardware_removed: "vent removed — degraded to no_vent",
};

function summarizeApplied(applied: SyncDiffEntry[]): string {
  const counts = new Map<string, number>();
  for (const entry of applied) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(
    ([kind, count]) =>
      `${count} zone${count === 1 ? "" : "s"} ${MATCHED_KIND_LABELS[kind] ?? kind}`,
  );
  return parts.length > 0 ? parts.join(" · ") : "No linked zones yet.";
}

/**
 * Matched changes are already applied by the time this renders — nothing
 * here waits for confirmation except the unmatched-room actions below.
 * See "Flair Sync Engine" in the implementation plan.
 */
export default function SyncZonesDialog({
  open,
  airHandlerId,
  zones,
  onClose,
  onSynced,
}: SyncZonesDialogProps) {
  const { showNotification } = useNotification();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SyncRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkTargetByRoomId, setLinkTargetByRoomId] = useState<
    Record<string, string>
  >({});
  const [nameByRoomId, setNameByRoomId] = useState<Record<string, string>>({});
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);

  const unlinkedZones = zones.filter((z) => z.flairRoomId === null);

  const runTheSync = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await runSync(airHandlerId));
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Sync failed — try again.");
    } finally {
      setLoading(false);
    }
  }, [airHandlerId]);

  useEffect(() => {
    if (open) {
      setResult(null);
      runTheSync();
    }
  }, [open, runTheSync]);

  const handleLink = useCallback(
    async (entry: UnmatchedSyncDiffEntry) => {
      const zoneId =
        linkTargetByRoomId[entry.flairRoomId] ??
        (entry.kind === "unmatched_suggested" ? entry.suggestedZoneId : "");
      if (!zoneId) return;
      setBusyRoomId(entry.flairRoomId);
      try {
        await linkRoomToZone(airHandlerId, entry.flairRoomId, zoneId);
        showNotification(`"${entry.name}" linked.`, "success");
        onSynced();
        await runTheSync();
      } catch (err) {
        showNotification(
          extractErrorMessage(err) ?? "Couldn't link — try again.",
          "error",
        );
      } finally {
        setBusyRoomId(null);
      }
    },
    [airHandlerId, linkTargetByRoomId, onSynced, runTheSync, showNotification],
  );

  const handleCreate = useCallback(
    async (entry: UnmatchedSyncDiffEntry) => {
      setBusyRoomId(entry.flairRoomId);
      try {
        await createZoneFromRoom(
          airHandlerId,
          entry.flairRoomId,
          nameByRoomId[entry.flairRoomId] ?? entry.name,
        );
        showNotification(`"${entry.name}" created.`, "success");
        onSynced();
        await runTheSync();
      } catch (err) {
        showNotification(
          extractErrorMessage(err) ?? "Couldn't create — try again.",
          "error",
        );
      } finally {
        setBusyRoomId(null);
      }
    },
    [airHandlerId, nameByRoomId, onSynced, runTheSync, showNotification],
  );

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Sync with Flair</DialogTitle>
      <DialogContent>
        {loading && (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress />
          </Box>
        )}
        {error && <DialogContentText color="error">{error}</DialogContentText>}
        {result && !loading && (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {summarizeApplied(result.applied)}
            </Typography>

            {result.unmatched.length === 0 ? (
              <Typography variant="body2">
                No unmatched rooms — every Flair room on this air handler is
                linked.
              </Typography>
            ) : (
              result.unmatched.map((entry) => (
                <Paper key={entry.flairRoomId} variant="outlined" sx={{ p: 2 }}>
                  <Stack spacing={1.5}>
                    <Box
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Typography variant="subtitle2">{entry.name}</Typography>
                      {entry.kind === "unmatched_suggested" && (
                        <Chip
                          size="small"
                          color="info"
                          label="Suggested match found"
                        />
                      )}
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {entry.liveVentIds.length} vent(s) ·{" "}
                      {entry.hasTemperatureSensor
                        ? "has temperature sensor"
                        : "no temperature sensor"}{" "}
                      ·{" "}
                      {entry.hasOccupancySensor
                        ? "has occupancy sensor"
                        : "no occupancy sensor"}
                    </Typography>

                    <Stack direction="row" spacing={1} alignItems="center">
                      <TextField
                        select
                        size="small"
                        label="Link to zone"
                        value={
                          linkTargetByRoomId[entry.flairRoomId] ??
                          (entry.kind === "unmatched_suggested"
                            ? entry.suggestedZoneId
                            : "")
                        }
                        onChange={(e) =>
                          setLinkTargetByRoomId((prev) => ({
                            ...prev,
                            [entry.flairRoomId]: e.target.value,
                          }))
                        }
                        sx={{ minWidth: 180 }}
                      >
                        {unlinkedZones.map((z) => (
                          <MenuItem key={z.id} value={z.id}>
                            {z.name}
                          </MenuItem>
                        ))}
                      </TextField>
                      <Button
                        size="small"
                        disabled={
                          busyRoomId === entry.flairRoomId ||
                          unlinkedZones.length === 0 ||
                          !(
                            linkTargetByRoomId[entry.flairRoomId] ??
                            (entry.kind === "unmatched_suggested"
                              ? entry.suggestedZoneId
                              : "")
                          )
                        }
                        onClick={() => handleLink(entry)}
                      >
                        Link
                      </Button>
                    </Stack>

                    <Stack direction="row" spacing={1} alignItems="center">
                      <TextField
                        size="small"
                        label="New zone name"
                        value={nameByRoomId[entry.flairRoomId] ?? entry.name}
                        onChange={(e) =>
                          setNameByRoomId((prev) => ({
                            ...prev,
                            [entry.flairRoomId]: e.target.value,
                          }))
                        }
                        sx={{ minWidth: 180 }}
                      />
                      <Button
                        size="small"
                        variant="outlined"
                        disabled={busyRoomId === entry.flairRoomId}
                        onClick={() => handleCreate(entry)}
                      >
                        Create new zone
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              ))
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
