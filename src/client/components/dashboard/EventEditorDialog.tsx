import { useState, type DragEvent } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Switch from "@mui/material/Switch";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Tooltip from "@mui/material/Tooltip";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import Divider from "@mui/material/Divider";
import type { Zone } from "~/client/api/zonesApi";
import type { AirHandler } from "~/client/api/airHandlersApi";
import type {
  ScheduleEvent,
  ScheduleEventRequest,
} from "~/client/api/schedulesApi";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";
import {
  asAbsoluteTemp,
  asTempDelta,
  toDisplayAbsolute,
  fromDisplayAbsolute,
  toDisplayDelta,
  fromDisplayDelta,
} from "~/shared/types/temperature";
import {
  computeDropSide,
  computeReorderedIndex,
  type DropTarget,
} from "~/client/components/shared/reorderDragLogic";
import { findOverlappingEvents } from "~/client/components/dashboard/scheduleOverlap";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// 72°F / 68°F — a reasonable starting cool/heat pair for a brand new room
// row. Defined directly as the fixed Celsius equivalents, per this
// project's "defaults defined directly in Celsius" convention (see
// Temperature units), and converted to whichever unit the viewer currently
// has configured for display.
const DEFAULT_COOL_SETPOINT_C = 22.22; // 72°F
const DEFAULT_HEAT_SETPOINT_C = 20; // 68°F

function maskToDays(mask: number): number[] {
  return DAY_LABELS.map((_, i) => i).filter((i) => (mask & (1 << i)) !== 0);
}

function daysToMask(days: number[]): number {
  return days.reduce((m, d) => m | (1 << d), 0);
}

interface ZoneSettingDraft {
  zoneId: string;
  coolSetpoint: string;
  heatSetpoint: string;
  comfortTolerance: string;
  assumeOccupied: boolean;
}

// Rounds to 2 decimals for display, matching the same convention System
// Parameters' toDisplayString uses — a temperature stepper doesn't need
// more precision than that, and it avoids float noise like "71.60000001".
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function zoneSettingsFromEvent(
  event: ScheduleEvent | null,
  temperatureUnit: "C" | "F",
): ZoneSettingDraft[] {
  return (event?.zone_settings ?? []).map((row) => ({
    zoneId: row.zone_id,
    coolSetpoint:
      row.cool_setpoint !== undefined
        ? String(
            round2(
              toDisplayAbsolute(
                asAbsoluteTemp(row.cool_setpoint),
                temperatureUnit,
              ),
            ),
          )
        : "",
    heatSetpoint:
      row.heat_setpoint !== undefined
        ? String(
            round2(
              toDisplayAbsolute(
                asAbsoluteTemp(row.heat_setpoint),
                temperatureUnit,
              ),
            ),
          )
        : "",
    comfortTolerance:
      row.comfort_tolerance !== undefined
        ? String(
            round2(
              toDisplayDelta(
                asTempDelta(row.comfort_tolerance),
                temperatureUnit,
              ),
            ),
          )
        : "",
    assumeOccupied: row.assume_occupied,
  }));
}

interface EventEditorDialogProps {
  open: boolean;
  zones: Zone[];
  airHandlers: AirHandler[];
  event: ScheduleEvent | null; // null => creating a new event
  /** Every other event in the same schedule (excluding this one) — used to detect and warn about room/time overlaps before saving. */
  otherEvents?: ScheduleEvent[];
  onClose: () => void;
  onSave: (event: ScheduleEventRequest) => void;
  /** Only offered when editing an existing event — nothing to delete for a not-yet-saved one. */
  onDelete?: () => void;
}

/**
 * Create/edit a single schedule event — time window, day-of-week toggles,
 * and a per-room settings list (a zone is "assigned" by having a row,
 * exactly matching the server's own `zone_settings` shape). Priority for
 * this event is simply the row order — no separate priority-order control:
 * a user already reorders rooms while entering them, so dragging (or the
 * up/down arrow fallback) those same rows is what sets contention priority,
 * submitted as `zone_priority_order` derived from the current row order.
 * A collapsed Advanced section keeps the event's per-air-handler
 * driving-zone pin. Doesn't call the API itself — the server has no
 * per-event PATCH route, only a whole-schedule one, so the owning page
 * (SchedulesPage) manages the full `events` array and PATCHes it; this
 * dialog just hands back one finished event via `onSave`.
 */
export default function EventEditorDialog({
  open,
  zones,
  airHandlers,
  event,
  otherEvents = [],
  onClose,
  onSave,
  onDelete,
}: EventEditorDialogProps) {
  const { temperatureUnit } = useDisplayUnit();

  const [mode, setMode] = useState<"active" | "inactive">(
    event?.mode ?? "active",
  );
  const [startTime, setStartTime] = useState(event?.start_time ?? "20:00");
  const [endTime, setEndTime] = useState(event?.end_time ?? "07:00");
  const [days, setDays] = useState<number[]>(
    maskToDays(event?.days_of_week ?? 0b1111111),
  );
  const [zoneSettings, setZoneSettings] = useState<ZoneSettingDraft[]>(
    zoneSettingsFromEvent(event, temperatureUnit),
  );
  const [drivingOverrides, setDrivingOverrides] = useState<
    Record<string, string>
  >(event?.driving_zone_overrides ?? {});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addZoneId, setAddZoneId] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingOverlapSave, setConfirmingOverlapSave] = useState(false);
  const [draggingZoneId, setDraggingZoneId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  // Reset every field on the closed→open transition — this dialog stays
  // mounted between opens (both for "add a new event" and "edit event X"),
  // so without this a cancelled attempt's input, or a previous event's
  // data, would leak into the next open. Adjusting state during render on
  // a prop change, mirroring every other dialog's own "seeded"/reset
  // pattern in this app, rather than a useEffect — see AddZoneDialog's own
  // comment for why.
  const [seededKey, setSeededKey] = useState<string>(`${open}:${event?.id}`);
  const currentKey = `${open}:${event?.id}`;
  if (currentKey !== seededKey) {
    setSeededKey(currentKey);
    if (open) {
      setMode(event?.mode ?? "active");
      setStartTime(event?.start_time ?? "20:00");
      setEndTime(event?.end_time ?? "07:00");
      setDays(maskToDays(event?.days_of_week ?? 0b1111111));
      setZoneSettings(zoneSettingsFromEvent(event, temperatureUnit));
      setDrivingOverrides(event?.driving_zone_overrides ?? {});
      setAdvancedOpen(false);
      setAddZoneId("");
      setConfirmingDelete(false);
      setConfirmingOverlapSave(false);
      setDraggingZoneId(null);
      setDropTarget(null);
    }
  }

  const assignedZoneIds = new Set(zoneSettings.map((r) => r.zoneId));
  const unassignedZones = zones.filter((z) => !assignedZoneIds.has(z.id));
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  const timesValid = startTime !== endTime;
  const daysValid = days.length > 0;
  const setpointsValid =
    mode === "inactive" ||
    zoneSettings.every(
      (r) => r.coolSetpoint.trim() !== "" && r.heatSetpoint.trim() !== "",
    );
  const canSave = timesValid && daysValid && setpointsValid;

  // Recomputed on every render from the current draft — cheap given the
  // small event counts involved, and it needs to stay live as the user
  // edits time/days/rooms, not just at save time.
  const overlaps = findOverlappingEvents(
    {
      start_time: startTime,
      end_time: endTime,
      days_of_week: daysToMask(days),
      zoneIds: zoneSettings.map((r) => r.zoneId),
    },
    otherEvents,
  );

  function updateRow(zoneId: string, patch: Partial<ZoneSettingDraft>): void {
    setZoneSettings((rows) =>
      rows.map((r) => (r.zoneId === zoneId ? { ...r, ...patch } : r)),
    );
  }

  function removeRow(zoneId: string): void {
    setZoneSettings((rows) => rows.filter((r) => r.zoneId !== zoneId));
  }

  function addRow(): void {
    if (!addZoneId) return;
    setZoneSettings((rows) => {
      // Every room after the first copies the previous row's values — fast
      // bulk entry when several rooms share the same numbers; only the
      // rooms that genuinely differ need their fields touched afterward.
      const previous = rows[rows.length - 1];
      const draft: ZoneSettingDraft = previous
        ? { ...previous, zoneId: addZoneId }
        : {
            zoneId: addZoneId,
            coolSetpoint: String(
              round2(
                toDisplayAbsolute(
                  asAbsoluteTemp(DEFAULT_COOL_SETPOINT_C),
                  temperatureUnit,
                ),
              ),
            ),
            heatSetpoint: String(
              round2(
                toDisplayAbsolute(
                  asAbsoluteTemp(DEFAULT_HEAT_SETPOINT_C),
                  temperatureUnit,
                ),
              ),
            ),
            comfortTolerance: "",
            assumeOccupied: false,
          };
      return [...rows, draft];
    });
    setAddZoneId("");
  }

  function moveRow(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= zoneSettings.length) return;
    setZoneSettings((rows) => {
      const next = [...rows];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function endRowDrag(): void {
    setDraggingZoneId(null);
    setDropTarget(null);
  }

  function handleRowDragOver(
    e: DragEvent<HTMLDivElement>,
    index: number,
  ): void {
    e.preventDefault();
    const side = computeDropSide(
      e.clientX,
      e.currentTarget.getBoundingClientRect(),
    );
    setDropTarget((prev) =>
      prev?.index === index && prev.side === side ? prev : { index, side },
    );
  }

  function handleRowDrop(): void {
    const target = dropTarget;
    const fromIndex = zoneSettings.findIndex(
      (r) => r.zoneId === draggingZoneId,
    );
    endRowDrag();
    if (!target || fromIndex === -1) return;
    const insertAt = computeReorderedIndex(fromIndex, target);
    if (insertAt === null) return;
    setZoneSettings((rows) => {
      const next = [...rows];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(insertAt, 0, moved);
      return next;
    });
  }

  function setDrivingOverride(airHandlerId: string, zoneId: string): void {
    setDrivingOverrides((prev) => {
      const next = { ...prev };
      if (zoneId) next[airHandlerId] = zoneId;
      else delete next[airHandlerId];
      return next;
    });
  }

  function handleSaveClick(): void {
    if (!canSave) return;
    if (overlaps.length > 0 && !confirmingOverlapSave) {
      setConfirmingOverlapSave(true);
      return;
    }
    performSave();
  }

  function performSave(): void {
    const request: ScheduleEventRequest = {
      id: event?.id,
      mode,
      start_time: startTime,
      end_time: endTime,
      days_of_week: daysToMask(days),
      zone_settings: zoneSettings.map((row) => ({
        zone_id: row.zoneId,
        assume_occupied: row.assumeOccupied,
        ...(mode === "active"
          ? {
              cool_setpoint: fromDisplayAbsolute(
                Number(row.coolSetpoint),
                temperatureUnit,
              ),
              heat_setpoint: fromDisplayAbsolute(
                Number(row.heatSetpoint),
                temperatureUnit,
              ),
            }
          : {}),
        ...(row.comfortTolerance.trim()
          ? {
              comfort_tolerance: fromDisplayDelta(
                Number(row.comfortTolerance),
                temperatureUnit,
              ),
            }
          : {}),
      })),
      // Priority is simply this event's own row order — no separate
      // control to keep in sync with it. See the component doc comment.
      ...(zoneSettings.length > 0
        ? { zone_priority_order: zoneSettings.map((row) => row.zoneId) }
        : {}),
      ...(Object.keys(drivingOverrides).length > 0
        ? { driving_zone_overrides: drivingOverrides }
        : {}),
    };
    onSave(request);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      sx={{
        // A precise, measured width (the Rooms row's own real content need,
        // 520px, plus DialogContent's 24px horizontal padding each side) —
        // not a generic sm/md breakpoint — so there's no leftover
        // whitespace beyond a small, deliberate safety margin. Capped to
        // the viewport on narrow screens via maxWidth here rather than
        // relying on the breakpoint system.
        "& .MuiDialog-paper": { width: 576, maxWidth: "calc(100% - 64px)" },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        {event ? "Edit event" : "Add event"}
        <FormControlLabel
          sx={{ flexShrink: 0, mr: 0 }}
          control={
            <Switch
              checked={mode === "active"}
              onChange={(e) =>
                setMode(e.target.checked ? "active" : "inactive")
              }
            />
          }
          label="Active"
        />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Stack spacing={1}>
            <Stack direction="row" spacing={2} alignItems="flex-start">
              <TextField
                label="Start time"
                type="time"
                size="small"
                value={startTime}
                sx={{ width: 150, flexShrink: 0 }}
                onChange={(e) => setStartTime(e.target.value)}
              />
              <TextField
                label="End time"
                type="time"
                size="small"
                value={endTime}
                error={!timesValid}
                helperText={!timesValid ? "Must differ from start time" : " "}
                sx={{ width: 150, flexShrink: 0 }}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center">
              <Tooltip title="An overnight window (e.g. 20:00–07:00) uses the day it starts — checking Sunday runs Sunday evening through Monday morning.">
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ width: "fit-content", flexShrink: 0 }}
                >
                  Days
                </Typography>
              </Tooltip>
              <ToggleButtonGroup
                value={days}
                size="small"
                onChange={(_e, next: number[]) => setDays(next)}
              >
                {DAY_LABELS.map((label, i) => (
                  <ToggleButton key={label} value={i}>
                    {label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Stack>
          </Stack>

          {overlaps.length > 0 && (
            <Alert severity="warning">
              <AlertTitle>
                Overlaps with {overlaps.length} existing period
                {overlaps.length > 1 ? "s" : ""}
              </AlertTitle>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {overlaps.map((o) => (
                  <li key={o.event.id}>
                    <Typography variant="body2">
                      {o.event.start_time}–{o.event.end_time} (
                      {o.event.mode === "inactive" ? "Inactive" : "Active"}) on{" "}
                      {o.overlappingDays.map((d) => DAY_LABELS[d]).join(", ")} —
                      shares{" "}
                      {o.sharedZoneIds
                        .map((id) => zonesById.get(id)?.name ?? id)
                        .join(", ")}
                    </Typography>
                  </li>
                ))}
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 0.5 }}
              >
                The more specific period (fewer days selected) governs; ties go
                to whichever was edited most recently.
              </Typography>
            </Alert>
          )}

          <Divider />

          <Box>
            <Tooltip title="Drag to reorder — the top room wins if these rooms compete for airflow during this period.">
              <Typography
                variant="subtitle2"
                sx={{ mb: 1.25, width: "fit-content" }}
              >
                Rooms
              </Typography>
            </Tooltip>
            <Stack spacing={1.25}>
              {zoneSettings.map((row, index) => {
                const zone = zonesById.get(row.zoneId);
                const label = zone?.name ?? row.zoneId;
                return (
                  <Box
                    key={row.zoneId}
                    draggable
                    onDragStart={() => setDraggingZoneId(row.zoneId)}
                    onDragOver={(e) => handleRowDragOver(e, index)}
                    onDrop={handleRowDrop}
                    onDragEnd={endRowDrag}
                    sx={{
                      position: "relative",
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 1,
                      opacity: draggingZoneId === row.zoneId ? 0.5 : 1,
                    }}
                  >
                    {draggingZoneId &&
                      draggingZoneId !== row.zoneId &&
                      dropTarget?.index === index && (
                        <Box
                          aria-hidden
                          data-testid="room-drop-indicator"
                          sx={{
                            position: "absolute",
                            left: 4,
                            right: 4,
                            height: 2,
                            borderRadius: 1,
                            bgcolor: "primary.main",
                            zIndex: 1,
                            ...(dropTarget.side === "before"
                              ? { top: -3 }
                              : { bottom: -3 }),
                          }}
                        />
                      )}
                    <Box sx={{ p: 0.75, display: "flex", gap: 0.75 }}>
                      {/* The arrows/drag cluster is a sibling of the whole
                          label+fields column, not nested inside the fields
                          row — so its own height (taller than a single text
                          field) sits alongside the label line too, instead
                          of stacking below it and inflating the row. */}
                      <Stack
                        alignItems="center"
                        justifyContent="center"
                        sx={{ flexShrink: 0 }}
                      >
                        <IconButton
                          size="small"
                          aria-label={`Move ${label} up`}
                          disabled={index === 0}
                          onClick={() => moveRow(index, -1)}
                          sx={{ p: 0.25 }}
                        >
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <DragIndicatorIcon
                          fontSize="small"
                          color="disabled"
                          sx={{ cursor: "grab", my: -0.25 }}
                        />
                        <IconButton
                          size="small"
                          aria-label={`Move ${label} down`}
                          disabled={index === zoneSettings.length - 1}
                          onClick={() => moveRow(index, 1)}
                          sx={{ p: 0.25 }}
                        >
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                      </Stack>

                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontWeight: 600, display: "block", mb: 1 }}
                        >
                          {label}
                        </Typography>
                        <Stack
                          direction="row"
                          spacing={0.75}
                          alignItems="center"
                          flexWrap="wrap"
                          useFlexGap
                        >
                          {mode === "active" && (
                            <>
                              <TextField
                                size="small"
                                type="number"
                                label={`Cool (°${temperatureUnit})`}
                                value={row.coolSetpoint}
                                sx={{ width: 90, flexShrink: 0 }}
                                onChange={(e) =>
                                  updateRow(row.zoneId, {
                                    coolSetpoint: e.target.value,
                                  })
                                }
                              />
                              <TextField
                                size="small"
                                type="number"
                                label={`Heat (°${temperatureUnit})`}
                                value={row.heatSetpoint}
                                sx={{ width: 90, flexShrink: 0 }}
                                onChange={(e) =>
                                  updateRow(row.zoneId, {
                                    heatSetpoint: e.target.value,
                                  })
                                }
                              />
                            </>
                          )}
                          <Tooltip title="The thermostat will allow the temperature to drift this far above/below the setpoint before calling for heating/cooling. Leave blank to use the system default.">
                            <TextField
                              size="small"
                              type="number"
                              label={`Tolerance, °${temperatureUnit}`}
                              value={row.comfortTolerance}
                              sx={{ width: 130, flexShrink: 0 }}
                              onChange={(e) =>
                                updateRow(row.zoneId, {
                                  comfortTolerance: e.target.value,
                                })
                              }
                            />
                          </Tooltip>
                          <FormControlLabel
                            sx={{ mr: 0, flexShrink: 0, whiteSpace: "nowrap" }}
                            control={
                              <Checkbox
                                size="small"
                                checked={row.assumeOccupied}
                                onChange={(e) =>
                                  updateRow(row.zoneId, {
                                    assumeOccupied: e.target.checked,
                                  })
                                }
                              />
                            }
                            label="Sleep Mode"
                          />
                          <IconButton
                            size="small"
                            aria-label={`Remove ${label} from this event`}
                            onClick={() => removeRow(row.zoneId)}
                            sx={{ flexShrink: 0 }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </Box>
                    </Box>
                  </Box>
                );
              })}
            </Stack>
            {unassignedZones.length > 0 && (
              <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                <TextField
                  select
                  size="small"
                  fullWidth
                  label="Add a room to this event"
                  value={addZoneId}
                  onChange={(e) => setAddZoneId(e.target.value)}
                >
                  {unassignedZones.map((z) => (
                    <MenuItem key={z.id} value={z.id}>
                      {z.name}
                    </MenuItem>
                  ))}
                </TextField>
                <IconButton
                  aria-label="Add room"
                  disabled={!addZoneId}
                  onClick={addRow}
                >
                  <AddIcon />
                </IconButton>
              </Stack>
            )}
          </Box>

          <Divider />

          <Button
            size="small"
            onClick={() => setAdvancedOpen((v) => !v)}
            sx={{ alignSelf: "flex-start" }}
          >
            {advancedOpen ? "Hide advanced" : "Show advanced"}
          </Button>
          {advancedOpen && (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Driving-zone override per air handler — pins which zone governs
                the thermostat call for this event, instead of the global
                default (or dynamic worst-off selection).
              </Typography>
              <Stack spacing={1}>
                {airHandlers.map((ah) => (
                  <TextField
                    key={ah.id}
                    select
                    size="small"
                    label={`Driving zone — ${ah.name}`}
                    value={drivingOverrides[ah.id] ?? ""}
                    onChange={(e) => setDrivingOverride(ah.id, e.target.value)}
                  >
                    <MenuItem value="">None (use global default)</MenuItem>
                    {zones
                      .filter((z) => z.airHandlerId === ah.id)
                      .map((z) => (
                        <MenuItem key={z.id} value={z.id}>
                          {z.name}
                        </MenuItem>
                      ))}
                  </TextField>
                ))}
              </Stack>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {confirmingDelete ? (
          <>
            <Typography
              variant="body2"
              color="error"
              sx={{ mr: "auto", alignSelf: "center" }}
            >
              Delete this event?
            </Typography>
            <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
            <Button color="error" variant="contained" onClick={onDelete}>
              Delete
            </Button>
          </>
        ) : confirmingOverlapSave && overlaps.length > 0 ? (
          <>
            <Typography
              variant="body2"
              color="warning.main"
              sx={{ mr: "auto", alignSelf: "center" }}
            >
              Save despite the overlap above?
            </Typography>
            <Button onClick={() => setConfirmingOverlapSave(false)}>
              Back
            </Button>
            <Button color="warning" variant="contained" onClick={performSave}>
              Save anyway
            </Button>
          </>
        ) : (
          <>
            {event && onDelete && (
              <Button
                color="error"
                sx={{ mr: "auto" }}
                onClick={() => setConfirmingDelete(true)}
              >
                Delete event
              </Button>
            )}
            <Button onClick={onClose}>Cancel</Button>
            <Button
              variant="contained"
              disabled={!canSave}
              onClick={handleSaveClick}
            >
              {event ? "Save event" : "Add event"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
