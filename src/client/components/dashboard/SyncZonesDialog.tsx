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
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import {
  runSync,
  linkRoomToZone,
  createZoneFromRoom,
  type SyncDiffEntry,
  type SyncRunResult,
  type UnmatchedSyncDiffEntry,
} from "~/client/api/syncApi";
import { triggerTick } from "~/client/api/controlApi";
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

// A zero-vent room resolves server-side to manual_fixed_vent (see
// syncService.ts's resolveImportedVentHardwareType), which requires a
// fixed position — this is the client-side mirror of that same check.
function needsFixedPosition(entry: UnmatchedSyncDiffEntry): boolean {
  return entry.liveVentIds.length === 0;
}

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
  // Only ever consulted for a room with zero live vents — that's the only
  // case the server resolves to manual_fixed_vent (see syncService.ts's
  // resolveImportedVentHardwareType) and therefore requires a fixed
  // position for. Never pre-filled with a guessed value — there's no real
  // physical fact to infer it from.
  const [fixedPositionByRoomId, setFixedPositionByRoomId] = useState<
    Record<string, string>
  >({});
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  // Which unmatched rooms are queued for the bulk "Import selected" action
  // below — defaults to everything selected on each fresh sync result, so
  // the common case (import every unmatched room) is a single click, per
  // the user's own framing: these are imports, not one-by-one creates.
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(
    new Set(),
  );
  const [bulkImporting, setBulkImporting] = useState(false);

  const unlinkedZones = zones.filter((z) => z.flairRoomId === null);

  const fixedPositionValid = useCallback(
    (entry: UnmatchedSyncDiffEntry) =>
      !needsFixedPosition(entry) ||
      (fixedPositionByRoomId[entry.flairRoomId] ?? "").trim() !== "",
    [fixedPositionByRoomId],
  );

  const runTheSync = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextResult = await runSync(airHandlerId);
      setResult(nextResult);
      setSelectedRoomIds(
        new Set(nextResult.unmatched.map((e) => e.flairRoomId)),
      );
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

  // Forces one immediate control-loop tick before refreshing — without
  // this, a just-imported zone shows no reading/classification until the
  // next scheduled tick (up to a full tick interval away), which reads as
  // broken right after import. A tick-trigger failure is swallowed (not
  // surfaced as an error) since the import/link itself already succeeded;
  // the normal scheduled tick still picks the zone up regardless.
  const refreshAfterImport = useCallback(async () => {
    try {
      await triggerTick();
    } catch {
      // The zone was still created/linked successfully — the next
      // scheduled tick will populate it regardless.
    }
    await runTheSync();
  }, [runTheSync]);

  const handleLink = useCallback(
    async (entry: UnmatchedSyncDiffEntry) => {
      const zoneId =
        linkTargetByRoomId[entry.flairRoomId] ??
        (entry.kind === "unmatched_suggested" ? entry.suggestedZoneId : "");
      if (!zoneId || !fixedPositionValid(entry)) return;
      setBusyRoomId(entry.flairRoomId);
      try {
        await linkRoomToZone(
          airHandlerId,
          entry.flairRoomId,
          zoneId,
          needsFixedPosition(entry)
            ? Number(fixedPositionByRoomId[entry.flairRoomId])
            : undefined,
        );
        showNotification(`"${entry.name}" linked.`, "success");
        onSynced();
        await refreshAfterImport();
      } catch (err) {
        showNotification(
          extractErrorMessage(err) ?? "Couldn't link — try again.",
          "error",
        );
      } finally {
        setBusyRoomId(null);
      }
    },
    [
      airHandlerId,
      fixedPositionByRoomId,
      fixedPositionValid,
      linkTargetByRoomId,
      onSynced,
      refreshAfterImport,
      showNotification,
    ],
  );

  const handleCreate = useCallback(
    async (entry: UnmatchedSyncDiffEntry) => {
      if (!fixedPositionValid(entry)) return;
      setBusyRoomId(entry.flairRoomId);
      try {
        await createZoneFromRoom(
          airHandlerId,
          entry.flairRoomId,
          nameByRoomId[entry.flairRoomId] ?? entry.name,
          needsFixedPosition(entry)
            ? Number(fixedPositionByRoomId[entry.flairRoomId])
            : undefined,
        );
        showNotification(`"${entry.name}" created.`, "success");
        onSynced();
        await refreshAfterImport();
      } catch (err) {
        showNotification(
          extractErrorMessage(err) ?? "Couldn't create — try again.",
          "error",
        );
      } finally {
        setBusyRoomId(null);
      }
    },
    [
      airHandlerId,
      fixedPositionByRoomId,
      fixedPositionValid,
      nameByRoomId,
      onSynced,
      refreshAfterImport,
      showNotification,
    ],
  );

  const toggleRoomSelected = useCallback((flairRoomId: string) => {
    setSelectedRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(flairRoomId)) next.delete(flairRoomId);
      else next.add(flairRoomId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!result) return;
    setSelectedRoomIds((prev) =>
      prev.size === result.unmatched.length
        ? new Set()
        : new Set(result.unmatched.map((e) => e.flairRoomId)),
    );
  }, [result]);

  // Imports every checked room as a new zone, sequentially — matches the
  // per-row "Import as new zone" action one at a time rather than
  // Promise.all, so one room's failure (e.g. a duplicate name) can't be
  // misattributed to another's, and so the running count is meaningful if
  // this ever grows a progress indicator. Refreshes once at the end, not
  // per room — a mid-batch refresh would reshuffle `result.unmatched`
  // (and this render's own selection) out from under the loop.
  const handleImportSelected = useCallback(async () => {
    if (!result) return;
    const toImport = result.unmatched.filter((e) =>
      selectedRoomIds.has(e.flairRoomId),
    );
    if (toImport.length === 0) return;
    setBulkImporting(true);
    let succeeded = 0;
    const failures: string[] = [];
    for (const entry of toImport) {
      if (!fixedPositionValid(entry)) {
        failures.push(`${entry.name}: needs a fixed position first`);
        continue;
      }
      try {
        await createZoneFromRoom(
          airHandlerId,
          entry.flairRoomId,
          nameByRoomId[entry.flairRoomId] ?? entry.name,
          needsFixedPosition(entry)
            ? Number(fixedPositionByRoomId[entry.flairRoomId])
            : undefined,
        );
        succeeded += 1;
      } catch (err) {
        failures.push(`${entry.name}: ${extractErrorMessage(err) ?? "failed"}`);
      }
    }
    if (succeeded > 0) onSynced();
    await refreshAfterImport();
    setBulkImporting(false);
    if (failures.length === 0) {
      showNotification(
        `Imported ${succeeded} zone${succeeded === 1 ? "" : "s"}.`,
        "success",
      );
    } else {
      showNotification(
        `Imported ${succeeded} of ${toImport.length} — ${failures.join("; ")}`,
        "error",
      );
    }
  }, [
    airHandlerId,
    fixedPositionByRoomId,
    fixedPositionValid,
    nameByRoomId,
    onSynced,
    refreshAfterImport,
    result,
    selectedRoomIds,
    showNotification,
  ]);

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
              <>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={
                          selectedRoomIds.size === result.unmatched.length
                        }
                        indeterminate={
                          selectedRoomIds.size > 0 &&
                          selectedRoomIds.size < result.unmatched.length
                        }
                        onChange={toggleSelectAll}
                        disabled={bulkImporting}
                      />
                    }
                    label={`${selectedRoomIds.size} of ${result.unmatched.length} selected`}
                  />
                  <Button
                    size="small"
                    variant="contained"
                    disabled={
                      bulkImporting ||
                      selectedRoomIds.size === 0 ||
                      result.unmatched.some(
                        (e) =>
                          selectedRoomIds.has(e.flairRoomId) &&
                          !fixedPositionValid(e),
                      )
                    }
                    onClick={handleImportSelected}
                  >
                    {bulkImporting
                      ? "Importing…"
                      : `Import selected (${selectedRoomIds.size})`}
                  </Button>
                </Box>
                {result.unmatched.map((entry) => (
                  <Paper
                    key={entry.flairRoomId}
                    variant="outlined"
                    sx={{ p: 2 }}
                  >
                    <Stack spacing={1.5}>
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <FormControlLabel
                          control={
                            <Checkbox
                              checked={selectedRoomIds.has(entry.flairRoomId)}
                              onChange={() =>
                                toggleRoomSelected(entry.flairRoomId)
                              }
                              disabled={bulkImporting}
                              size="small"
                            />
                          }
                          label={
                            <Typography variant="subtitle2">
                              {entry.name}
                            </Typography>
                          }
                        />
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

                      {needsFixedPosition(entry) && (
                        <TextField
                          size="small"
                          type="number"
                          label="Fixed position (0–100%)"
                          value={fixedPositionByRoomId[entry.flairRoomId] ?? ""}
                          onChange={(e) =>
                            setFixedPositionByRoomId((prev) => ({
                              ...prev,
                              [entry.flairRoomId]: e.target.value,
                            }))
                          }
                          helperText="No Flair-controlled vent reported — treated as a manual vent, which needs its position set here."
                          sx={{ maxWidth: 240 }}
                        />
                      )}

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
                            bulkImporting ||
                            busyRoomId === entry.flairRoomId ||
                            unlinkedZones.length === 0 ||
                            !(
                              linkTargetByRoomId[entry.flairRoomId] ??
                              (entry.kind === "unmatched_suggested"
                                ? entry.suggestedZoneId
                                : "")
                            ) ||
                            !fixedPositionValid(entry)
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
                          disabled={
                            bulkImporting ||
                            busyRoomId === entry.flairRoomId ||
                            !fixedPositionValid(entry)
                          }
                          onClick={() => handleCreate(entry)}
                        >
                          Import as new zone
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </>
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
