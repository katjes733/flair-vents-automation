import { useCallback, useEffect, useState } from "react";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import DialogContentText from "@mui/material/DialogContentText";
import AddIcon from "@mui/icons-material/Add";
import {
  fetchSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  type Schedule,
  type ScheduleEvent,
  type ScheduleEventRequest,
} from "~/client/api/schedulesApi";
import { fetchZones, type Zone } from "~/client/api/zonesApi";
import { fetchAirHandlers, type AirHandler } from "~/client/api/airHandlersApi";
import { extractErrorMessage } from "~/client/api/errorMessage";
import { useNotification } from "~/client/components/notification/useNotification";
import ScheduleRoomsOverview from "~/client/components/dashboard/ScheduleRoomsOverview";
import EventEditorDialog from "~/client/components/dashboard/EventEditorDialog";

// The event's own already-validated fields, minus the two server-only
// timestamps — exactly what a PATCH's whole-array `events` replace needs
// for an event that isn't the one currently being edited.
function toEventRequest(event: ScheduleEvent): ScheduleEventRequest {
  return {
    id: event.id,
    mode: event.mode,
    start_time: event.start_time,
    end_time: event.end_time,
    days_of_week: event.days_of_week,
    zone_settings: event.zone_settings,
    ...(event.zone_priority_order
      ? { zone_priority_order: event.zone_priority_order }
      : {}),
    ...(event.driving_zone_overrides
      ? { driving_zone_overrides: event.driving_zone_overrides }
      : {}),
  };
}

/**
 * Schedule management — a picker across the installation's schedules, the
 * selected one's per-room overview (ScheduleRoomsOverview — one compact
 * week-strip card per room, not a single combined grid), and add/edit/delete
 * for both schedules and their individual events (EventEditorDialog). The
 * server has no per-event PATCH route, only a whole-schedule one, so every
 * event add/edit/delete here rebuilds the schedule's complete `events`
 * array and PATCHes it in one call — see toEventRequest's own comment.
 */
export default function SchedulesPage() {
  const { showNotification } = useNotification();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [airHandlers, setAirHandlers] = useState<AirHandler[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const [eventEditorOpen, setEventEditorOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<ScheduleEvent | null>(null);

  const loadAll = useCallback(async () => {
    const [scheduleList, zoneList, handlerList] = await Promise.all([
      fetchSchedules(),
      fetchZones(),
      fetchAirHandlers(),
    ]);
    setSchedules(scheduleList);
    setZones(zoneList);
    setAirHandlers(handlerList);
    setSelectedId((prev) =>
      prev && scheduleList.some((s) => s.id === prev)
        ? prev
        : (scheduleList[0]?.id ?? null),
    );
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const selected = schedules.find((s) => s.id === selectedId) ?? null;

  async function handleCreateSchedule() {
    if (!newName.trim()) return;
    setError(null);
    try {
      const created = await createSchedule({ name: newName.trim() });
      showNotification(`Schedule "${created.name}" created.`, "success");
      setAddOpen(false);
      setNewName("");
      setSchedules((prev) => [...prev, created]);
      setSelectedId(created.id);
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't create the schedule.");
    }
  }

  async function handleDeleteSchedule() {
    if (!selected) return;
    setError(null);
    try {
      await deleteSchedule(selected.id);
      showNotification(`Schedule "${selected.name}" deleted.`, "success");
      setDeleteConfirmOpen(false);
      await loadAll();
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't delete the schedule.");
    }
  }

  async function handleToggleEnabled(enabled: boolean) {
    if (!selected) return;
    setError(null);
    try {
      const updated = await updateSchedule(selected.id, {
        config: { ...selected.config, enabled },
      });
      setSchedules((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s)),
      );
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't update the schedule.");
    }
  }

  function openAddEvent() {
    setEditingEvent(null);
    setEventEditorOpen(true);
  }

  function openEditEvent(event: ScheduleEvent) {
    setEditingEvent(event);
    setEventEditorOpen(true);
  }

  async function handleSaveEvent(request: ScheduleEventRequest) {
    if (!selected) return;
    setError(null);
    const others = selected.events
      .filter((e) => e.id !== request.id)
      .map(toEventRequest);
    const nextEvents = [...others, request];
    try {
      const updated = await updateSchedule(selected.id, { events: nextEvents });
      setSchedules((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s)),
      );
      setEventEditorOpen(false);
      showNotification("Event saved.", "success");
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't save the event.");
    }
  }

  async function handleDeleteEvent() {
    if (!selected || !editingEvent) return;
    setError(null);
    const nextEvents = selected.events
      .filter((e) => e.id !== editingEvent.id)
      .map(toEventRequest);
    try {
      const updated = await updateSchedule(selected.id, { events: nextEvents });
      setSchedules((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s)),
      );
      setEventEditorOpen(false);
      showNotification("Event deleted.", "success");
    } catch (err) {
      setError(extractErrorMessage(err) ?? "Couldn't delete the event.");
    }
  }

  if (loading) {
    return (
      <Container
        maxWidth="md"
        sx={{ px: 2, display: "flex", justifyContent: "center", mt: 4 }}
      >
        <CircularProgress />
      </Container>
    );
  }

  return (
    <Container maxWidth="md" sx={{ px: 2, pb: 4 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mb: 2,
        }}
      >
        <Typography variant="h5" fontWeight={600}>
          Schedules
        </Typography>
        <Button startIcon={<AddIcon />} onClick={() => setAddOpen(true)}>
          Add schedule
        </Button>
      </Box>

      {error && (
        <DialogContentText color="error" sx={{ mb: 2 }}>
          {error}
        </DialogContentText>
      )}

      {schedules.length === 0 ? (
        <Typography color="text.secondary">
          No schedules yet — add one to get started.
        </Typography>
      ) : (
        <>
          <Stack
            direction="row"
            spacing={2}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={{ mb: 2 }}
          >
            <TextField
              select
              size="small"
              label="Schedule"
              value={selectedId ?? ""}
              onChange={(e) => setSelectedId(e.target.value)}
              sx={{ minWidth: 220 }}
            >
              {schedules.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
            {selected && (
              <>
                <FormControlLabel
                  control={
                    <Switch
                      checked={selected.config.enabled}
                      onChange={(e) => handleToggleEnabled(e.target.checked)}
                    />
                  }
                  label="Enabled"
                />
                <Button
                  color="error"
                  size="small"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  Delete schedule
                </Button>
              </>
            )}
          </Stack>

          {selected && (
            <>
              <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={openAddEvent}
                >
                  Add event
                </Button>
              </Box>
              <ScheduleRoomsOverview
                schedule={selected}
                zones={zones}
                onEditEvent={openEditEvent}
              />
            </>
          )}
        </>
      )}

      <Dialog open={addOpen} onClose={() => setAddOpen(false)}>
        <DialogTitle>Add schedule</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newName.trim()}
            onClick={handleCreateSchedule}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
      >
        <DialogTitle>Delete "{selected?.name}"?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This deletes the schedule and every one of its events. This can't be
            undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteSchedule}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {selected && (
        <EventEditorDialog
          open={eventEditorOpen}
          zones={zones}
          airHandlers={airHandlers}
          event={editingEvent}
          otherEvents={selected.events.filter((e) => e.id !== editingEvent?.id)}
          onClose={() => setEventEditorOpen(false)}
          onSave={handleSaveEvent}
          onDelete={editingEvent ? handleDeleteEvent : undefined}
        />
      )}
    </Container>
  );
}
