/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { DisplayUnitProvider } from "~/client/theme/DisplayUnitProvider";
import type { ScheduleEvent } from "~/client/api/schedulesApi";

afterEach(cleanup);

const { fetchSettings } = vi.hoisted(() => ({ fetchSettings: vi.fn() }));
vi.mock("~/client/api/settingsApi", () => ({ fetchSettings }));

const { default: ScheduleMatrix } =
  await import("~/client/components/dashboard/ScheduleMatrix");

const theme = createTheme();

function makeEvent(overrides: Partial<ScheduleEvent> = {}): ScheduleEvent {
  return {
    id: "ev-1",
    created_at: "2024-01-01T00:00:00.000Z",
    modified_at: "2024-01-01T00:00:00.000Z",
    mode: "active",
    start_time: "08:00",
    end_time: "17:00",
    days_of_week: 0b1111111,
    zone_settings: [
      {
        zone_id: "z1",
        cool_setpoint: 22,
        heat_setpoint: 20,
        assume_occupied: false,
      },
    ],
    ...overrides,
  };
}

function renderMatrix(
  events: ScheduleEvent[],
  zoneId = "z1",
  onEditEvent = vi.fn(),
) {
  return {
    ...render(
      <ThemeProvider theme={theme}>
        <DisplayUnitProvider>
          <ScheduleMatrix
            zoneId={zoneId}
            events={events}
            onEditEvent={onEditEvent}
          />
        </DisplayUnitProvider>
      </ThemeProvider>,
    ),
    onEditEvent,
  };
}

describe("ScheduleMatrix", () => {
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

  it("renders one clickable block per day the event covers, and calls onEditEvent with that event", () => {
    const event = makeEvent({ days_of_week: 0b1111111 });
    const { onEditEvent } = renderMatrix([event]);
    const blocks = screen.getAllByRole("button", {
      name: "Edit event, 08:00 to 17:00",
    });
    expect(blocks).toHaveLength(7);
    fireEvent.click(blocks[0]);
    expect(onEditEvent).toHaveBeenCalledWith(event);
  });

  it("a wraparound event's tail is clickable in the next day's column too", () => {
    renderMatrix([
      makeEvent({
        start_time: "20:30",
        end_time: "07:00",
        days_of_week: 0b0000001,
      }),
    ]);
    // One segment in Sunday's column, one tail segment in Monday's.
    expect(
      screen.getAllByRole("button", { name: "Edit event, 20:30 to 07:00" }),
    ).toHaveLength(2);
  });

  it("shows a hatched range for the losing event where two events overlap", () => {
    const broad = makeEvent({
      id: "broad",
      start_time: "08:00",
      end_time: "17:00",
      days_of_week: 0b1111111,
    });
    const specific = makeEvent({
      id: "specific",
      start_time: "08:00",
      end_time: "17:00",
      days_of_week: 0b0000001, // more specific — wins on Sunday
    });
    renderMatrix([broad, specific]);
    // broad loses on Sunday (day 0) only — hatched exactly once.
    expect(screen.getAllByTestId("matrix-hatched-range")).toHaveLength(1);
  });

  it("two non-overlapping events show no hatching at all", () => {
    renderMatrix([
      makeEvent({ id: "a", start_time: "06:00", end_time: "08:00" }),
      makeEvent({ id: "b", start_time: "18:00", end_time: "20:00" }),
    ]);
    expect(
      screen.queryByTestId("matrix-hatched-range"),
    ).not.toBeInTheDocument();
  });

  it("shows this zone's own resolved cool/heat values, not another zone's", () => {
    const event = makeEvent({
      zone_settings: [
        {
          zone_id: "z1",
          cool_setpoint: 21.11,
          heat_setpoint: 18.89,
          assume_occupied: false,
        }, // ~70/66°F
        {
          zone_id: "z2",
          cool_setpoint: 22.22,
          heat_setpoint: 20,
          assume_occupied: false,
        }, // ~72/68°F
      ],
    });
    renderMatrix([event], "z1");
    expect(screen.getAllByText("70/66").length).toBeGreaterThan(0);
    expect(screen.queryByText("72/68")).not.toBeInTheDocument();
  });

  it("renders no blocks and doesn't crash when this zone has no events", () => {
    renderMatrix([]);
    expect(
      screen.queryByRole("button", { name: /Edit event/ }),
    ).not.toBeInTheDocument();
  });
});
