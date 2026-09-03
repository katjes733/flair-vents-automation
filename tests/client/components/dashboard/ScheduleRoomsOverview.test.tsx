/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { DisplayUnitProvider } from "~/client/theme/DisplayUnitProvider";
import type { Schedule, ScheduleEvent } from "~/client/api/schedulesApi";
import type { Zone } from "~/client/api/zonesApi";
import { buildColorByEventId } from "~/client/components/dashboard/scheduleEventColors";

afterEach(cleanup);

const { fetchSettings } = vi.hoisted(() => ({ fetchSettings: vi.fn() }));
vi.mock("~/client/api/settingsApi", () => ({ fetchSettings }));

const { default: ScheduleRoomsOverview } =
  await import("~/client/components/dashboard/ScheduleRoomsOverview");

const theme = createTheme();

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
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
      flair_vents: [],
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
    ...overrides,
  };
}

const ZONES: Zone[] = [
  makeZone({ id: "z1", name: "Den Front" }),
  makeZone({ id: "z2", name: "Martin Bedroom" }),
];

function makeEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: "ev-1",
    created_at: "2024-01-01T00:00:00.000Z",
    modified_at: "2024-01-01T00:00:00.000Z",
    mode: "active",
    start_time: "20:00",
    end_time: "07:00",
    days_of_week: 0b1111111,
    zone_settings: [],
    ...overrides,
  };
}

function schedule(overrides: Partial<Schedule> = {}): Schedule {
  return {
    id: "sched-1",
    installationId: "inst-1",
    name: "Night",
    events: [],
    config: { enabled: true, default_inactive: false },
    ...overrides,
  };
}

function renderOverview(sched: Schedule, zones = ZONES, onEditEvent = vi.fn()) {
  return {
    ...render(
      <ThemeProvider theme={theme}>
        <DisplayUnitProvider>
          <ScheduleRoomsOverview
            schedule={sched}
            zones={zones}
            onEditEvent={onEditEvent}
          />
        </DisplayUnitProvider>
      </ThemeProvider>,
    ),
    onEditEvent,
  };
}

describe("ScheduleRoomsOverview", () => {
  beforeEach(() => {
    localStorage.setItem("displayTemperatureUnit", "F");
    fetchSettings.mockReset().mockResolvedValue({
      display_temperature_unit: "F",
      display_airflow_unit: "Lps",
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows no cards, just the empty-state message, when no room has any period yet", () => {
    renderOverview(schedule({ events: [] }));
    expect(screen.queryByText("Den Front")).not.toBeInTheDocument();
    expect(screen.queryByText("Martin Bedroom")).not.toBeInTheDocument();
    expect(
      screen.getByText("No periods yet — add one above to start scheduling."),
    ).toBeInTheDocument();
  });

  it("shows a card only for a room with at least one period, not an unused room", () => {
    const event = makeEvent({
      start_time: "08:00",
      end_time: "17:00",
      zone_settings: [
        {
          zone_id: "z1",
          cool_setpoint: 22,
          heat_setpoint: 20,
          assume_occupied: false,
        },
      ],
    });
    renderOverview(schedule({ events: [event] }));
    expect(screen.getByText("Den Front")).toBeInTheDocument();
    expect(screen.queryByText("Martin Bedroom")).not.toBeInTheDocument();
    // One block per day (no wraparound tail) on the one assigned card.
    expect(
      screen.getAllByRole("button", { name: "Edit event, 08:00 to 17:00" }),
    ).toHaveLength(7);
  });

  it("a period spanning two rooms renders a block on both rooms' cards, and clicking either calls onEditEvent with it", () => {
    const event = makeEvent({
      start_time: "08:00",
      end_time: "17:00",
      zone_settings: [
        {
          zone_id: "z1",
          cool_setpoint: 22,
          heat_setpoint: 20,
          assume_occupied: false,
        },
        {
          zone_id: "z2",
          cool_setpoint: 18,
          heat_setpoint: 16,
          assume_occupied: true,
        },
      ],
    });
    const { onEditEvent } = renderOverview(schedule({ events: [event] }));
    const blocks = screen.getAllByRole("button", {
      name: "Edit event, 08:00 to 17:00",
    });
    // 7 days each, on both of the two rooms' cards.
    expect(blocks).toHaveLength(14);
    fireEvent.click(blocks[0]);
    expect(onEditEvent).toHaveBeenCalledWith(event);
  });

  it("assigns the same color to the same event across every room, via the shared colorByEventId map", () => {
    const eventA = makeEvent({ id: "a" });
    const eventB = makeEvent({
      id: "b",
      start_time: "08:00",
      end_time: "17:00",
    });
    const map = buildColorByEventId([eventA, eventB]);
    expect(map.get("a")).toBeDefined();
    expect(map.get("b")).toBeDefined();
    expect(map.get("a")).not.toBe(map.get("b"));
  });

  it("shows a message instead of any cards when there are no zones", () => {
    renderOverview(schedule({ events: [] }), []);
    expect(screen.getByText("No rooms configured yet.")).toBeInTheDocument();
  });
});
