/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { AirHandler } from "~/client/api/airHandlersApi";
import type { Zone } from "~/client/api/zonesApi";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";

afterEach(cleanup);

const { fetchAirHandlers } = vi.hoisted(() => ({
  fetchAirHandlers: vi.fn(),
}));
vi.mock("~/client/api/airHandlersApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/airHandlersApi")>();
  return { ...actual, fetchAirHandlers };
});

const { fetchZones } = vi.hoisted(() => ({ fetchZones: vi.fn() }));
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, fetchZones };
});

const { fetchTickHistory } = vi.hoisted(() => ({ fetchTickHistory: vi.fn() }));
vi.mock("~/client/api/telemetryApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/telemetryApi")>();
  return { ...actual, fetchTickHistory };
});

const { default: TelemetryPage } =
  await import("~/client/components/telemetry/TelemetryPage");

const theme = createTheme();

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

const ZONE: Zone = {
  id: "z1",
  installationId: "inst-1",
  airHandlerId: "ah-1",
  flairRoomId: "room-1",
  name: "Martin Bedroom",
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
    last_reading_value: 22.5,
    last_reading_changed_at: null,
    stale: false,
    spike_active: false,
    spike_since: null,
    last_classification: null,
    occupied: false,
    occupancy_pending_flip_since: null,
  },
};

const OTHER_ZONE: Zone = { ...ZONE, id: "z2", name: "Den Front" };

function makePoints(): TickHistoryPoint[] {
  return [
    {
      loggedAtMs: 1000,
      decision: {
        air_handler_id: "ah-1",
        tick_at: "2026-09-02T12:00:00.000Z",
        duration_ms: 1,
        dry_run: false,
        control_disarmed: false,
        equipment_fault_active: false,
        hvac_state: "COOLING_CALL",
        call_confidence: "reported",
        zones: [
          {
            zone_id: "z1",
            name: "Martin Bedroom",
            vent_hardware_type: "flair_smart_vent",
            classification: "demanding",
            occupied: false,
            spiking: false,
            temp_calibrated: 24,
            resolved_setpoint: 21,
            desired_position_pct: 60,
            post_contention_position_pct: 60,
            vents: [
              {
                flair_vent_id: "vent-1",
                name: "Bedroom Vent",
                commanded_position_pct: 60,
                reported_position_pct: 58,
                dispatch_decision: "dispatched",
                degraded: false,
                voltage: null,
                current_rssi: null,
              },
            ],
            reason: "",
          },
        ],
        contention: null,
        pressure: {
          aggregate_open_lps: 400,
          aggregate_open_pct: 45,
          floor_lps: 300,
          cap_pct: 80,
          clamped: false,
          blower_rated_flow_rate_is_estimate: false,
          minimum_aggregate_flow_is_estimate: false,
        },
        driving_zone: { zone_id: "z1", reason: "dynamic_worst_off" },
        setpoint_push: null,
        narrative: "",
      },
    },
  ];
}

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <TelemetryPage />
    </ThemeProvider>,
  );
}

describe("TelemetryPage", () => {
  beforeEach(() => {
    fetchAirHandlers.mockReset().mockResolvedValue([AIR_HANDLER]);
    fetchZones.mockReset().mockResolvedValue([ZONE, OTHER_ZONE]);
    fetchTickHistory.mockReset().mockResolvedValue(makePoints());
  });

  it("defaults to the first air handler/zone and renders both sections once data loads", async () => {
    renderPage();

    expect(await screen.findByText("Air Handler")).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Martin Bedroom" }),
    ).toBeInTheDocument();
    expect(fetchTickHistory).toHaveBeenCalledWith(
      "ah-1",
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("shows an unavailable message when Loki isn't configured (fetch resolves null)", async () => {
    fetchTickHistory.mockResolvedValue(null);
    renderPage();
    expect(
      await screen.findByText(/Historical telemetry is not available/),
    ).toBeInTheDocument();
  });

  it("shows a distinct empty-window message when Loki is configured but has nothing logged yet", async () => {
    fetchTickHistory.mockResolvedValue([]);
    renderPage();
    expect(
      await screen.findByText(
        /nothing has been logged for this air handler in the selected window/,
      ),
    ).toBeInTheDocument();
  });

  it("switching the zone selector re-scopes the per-zone section", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Martin Bedroom");

    await user.click(screen.getByRole("combobox", { name: "Zone" }));
    await user.click(await screen.findByRole("option", { name: "Den Front" }));

    expect(await screen.findAllByText("Den Front")).not.toHaveLength(0);
  });

  it("the refresh button re-fetches tick history", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Martin Bedroom");
    const callsBefore = fetchTickHistory.mock.calls.length;

    await user.click(screen.getByRole("button", { name: "Refresh" }));

    expect(fetchTickHistory.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it("changing the range re-fetches with a wider window", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Martin Bedroom");

    await user.click(screen.getByRole("combobox", { name: "Range" }));
    await user.click(
      await screen.findByRole("option", { name: "Last 7 days" }),
    );

    const lastCall = fetchTickHistory.mock.calls.at(-1);
    const [, fromMs, toMs] = lastCall as [string, number, number];
    expect(toMs - fromMs).toBe(7 * 24 * 3600 * 1000);
  });
});
