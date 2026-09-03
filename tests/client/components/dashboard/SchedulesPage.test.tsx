/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  within,
} from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import { DisplayUnitProvider } from "~/client/theme/DisplayUnitProvider";
import type { Schedule, ScheduleEvent } from "~/client/api/schedulesApi";
import type { Zone } from "~/client/api/zonesApi";
import type { AirHandler } from "~/client/api/airHandlersApi";

afterEach(cleanup);

const {
  fetchSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  fetchZones,
  fetchAirHandlers,
  fetchSettings,
} = vi.hoisted(() => ({
  fetchSchedules: vi.fn(),
  createSchedule: vi.fn(),
  updateSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
  fetchZones: vi.fn(),
  fetchAirHandlers: vi.fn(),
  fetchSettings: vi.fn(),
}));
vi.mock("~/client/api/schedulesApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/schedulesApi")>();
  return {
    ...actual,
    fetchSchedules,
    createSchedule,
    updateSchedule,
    deleteSchedule,
  };
});
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, fetchZones };
});
vi.mock("~/client/api/airHandlersApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/airHandlersApi")>();
  return { ...actual, fetchAirHandlers };
});
vi.mock("~/client/api/settingsApi", () => ({ fetchSettings }));

const { default: SchedulesPage } =
  await import("~/client/components/dashboard/SchedulesPage");

const theme = createTheme();

const ZONE: Zone = {
  id: "z1",
  installationId: "inst-1",
  airHandlerId: "ah-1",
  flairRoomId: null,
  name: "Den Front",
  ventHardwareType: "flair_smart_vent",
  config: {
    has_temperature_sensor: true,
    has_occupancy_sensor: false,
    thermal_load_flags: [],
    idle_baseline_position: 100,
    sensor_calibration_offset: 0,
    min_vent_position: 0,
    max_vent_position: 100,
    flair_vents: [{ flair_vent_id: "vent-1" }],
    manual_vents: [],
    display_order: 0,
  },
  state: {
    last_target_position: null,
    last_commanded_at: null,
    vents: [],
    last_reading_value: null,
    last_reading_changed_at: null,
    stale: false,
    spike_active: false,
    spike_since: null,
    last_classification: null,
    occupied: false,
    occupancy_pending_flip_since: null,
  },
};

const AIR_HANDLER: AirHandler = {
  id: "ah-1",
  installationId: "inst-1",
  flairZoneId: null,
  name: "Upstairs",
  active: true,
  config: {
    topology_mode: "variable_speed",
    blower_rated_flow_rate_is_estimate: true,
    minimum_aggregate_flow_is_estimate: true,
  },
};

const EVENT: ScheduleEvent = {
  id: "ev-1",
  created_at: "2024-01-01T00:00:00.000Z",
  modified_at: "2024-01-01T00:00:00.000Z",
  mode: "active",
  start_time: "20:00",
  end_time: "07:00",
  days_of_week: 0b1111111,
  zone_settings: [
    {
      zone_id: "z1",
      cool_setpoint: 22,
      heat_setpoint: 20,
      assume_occupied: false,
    },
  ],
};

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "sched-1",
    installationId: "inst-1",
    name: "Night",
    events: [EVENT],
    config: { enabled: true, default_inactive: false },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <DisplayUnitProvider>
        <NotificationProvider>
          <SchedulesPage />
        </NotificationProvider>
      </DisplayUnitProvider>
    </ThemeProvider>,
  );
}

describe("SchedulesPage", () => {
  beforeEach(() => {
    localStorage.setItem("displayTemperatureUnit", "F");
    fetchSchedules.mockReset().mockResolvedValue([schedule()]);
    createSchedule.mockReset();
    updateSchedule.mockReset();
    deleteSchedule.mockReset().mockResolvedValue(undefined);
    fetchZones.mockReset().mockResolvedValue([ZONE]);
    fetchAirHandlers.mockReset().mockResolvedValue([AIR_HANDLER]);
    fetchSettings.mockReset().mockResolvedValue({
      display_temperature_unit: "F",
      display_airflow_unit: "Lps",
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("loads and shows the schedule picker with the matrix for the first schedule", async () => {
    renderPage();
    expect(await screen.findByText("Sun")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Schedule" }),
    ).toHaveTextContent("Night");
    expect(screen.getByRole("switch", { name: "Enabled" })).toBeChecked();
  });

  it("shows a fallback message when there are no schedules yet", async () => {
    fetchSchedules.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText("No schedules yet — add one to get started."),
    ).toBeInTheDocument();
  });

  it("creates a new schedule and selects it", async () => {
    const created = schedule({ id: "sched-2", name: "Away", events: [] });
    createSchedule.mockResolvedValue(created);
    renderPage();
    await screen.findByText("Sun");

    fireEvent.click(screen.getByRole("button", { name: "Add schedule" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Away" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(createSchedule).toHaveBeenCalledWith({ name: "Away" }),
    );
    expect(
      await screen.findByRole("combobox", { name: "Schedule" }),
    ).toHaveTextContent("Away");
  });

  it("toggling Enabled sends the full config object, not a bare partial", async () => {
    updateSchedule.mockResolvedValue(
      schedule({ config: { enabled: false, default_inactive: false } }),
    );
    renderPage();
    await screen.findByText("Sun");
    fireEvent.click(screen.getByRole("switch", { name: "Enabled" }));
    await waitFor(() =>
      expect(updateSchedule).toHaveBeenCalledWith("sched-1", {
        config: { enabled: false, default_inactive: false },
      }),
    );
  });

  it("deletes the selected schedule after confirmation", async () => {
    fetchSchedules
      .mockResolvedValueOnce([schedule()])
      .mockResolvedValueOnce([]);
    renderPage();
    await screen.findByText("Sun");
    fireEvent.click(screen.getByRole("button", { name: "Delete schedule" }));
    expect(screen.getByText('Delete "Night"?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteSchedule).toHaveBeenCalledWith("sched-1"));
    expect(
      await screen.findByText("No schedules yet — add one to get started."),
    ).toBeInTheDocument();
  });

  it("clicking a matrix block opens the editor pre-filled, and Save patches the whole events array", async () => {
    updateSchedule.mockResolvedValue(schedule());
    renderPage();
    await screen.findByText("Sun");

    const [block] = screen.getAllByRole("button", {
      name: "Edit event, 20:00 to 07:00",
    });
    fireEvent.click(block);

    expect(await screen.findByText("Edit event")).toBeInTheDocument();
    expect(screen.getByLabelText("Start time")).toHaveValue("20:00");

    fireEvent.click(screen.getByRole("button", { name: "Save event" }));
    await waitFor(() => expect(updateSchedule).toHaveBeenCalledTimes(1));
    const [, patch] = updateSchedule.mock.calls[0];
    expect(patch.events).toHaveLength(1);
    expect(patch.events[0].id).toBe("ev-1");
  });

  it("Add event appends a new event to the existing array on save", async () => {
    updateSchedule.mockResolvedValue(schedule());
    renderPage();
    await screen.findByText("Sun");

    fireEvent.click(screen.getByRole("button", { name: "Add event" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Add event" }));

    await waitFor(() => expect(updateSchedule).toHaveBeenCalledTimes(1));
    const [, patch] = updateSchedule.mock.calls[0];
    // The existing seeded event plus the newly-added one.
    expect(patch.events).toHaveLength(2);
  });

  it("deleting an event via the editor removes it from the patched array", async () => {
    updateSchedule.mockResolvedValue(schedule({ events: [] }));
    renderPage();
    await screen.findByText("Sun");

    const [block] = screen.getAllByRole("button", {
      name: "Edit event, 20:00 to 07:00",
    });
    fireEvent.click(block);
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete event" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(updateSchedule).toHaveBeenCalledWith("sched-1", { events: [] }),
    );
  });
});
