/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { AirHandler } from "~/client/api/airHandlersApi";
import type { Zone } from "~/client/api/zonesApi";

afterEach(cleanup);

const { fetchAirHandlers, fetchAirHandlerTickDecision } = vi.hoisted(() => ({
  fetchAirHandlers: vi.fn(),
  fetchAirHandlerTickDecision: vi.fn(),
}));
const { fetchZones } = vi.hoisted(() => ({ fetchZones: vi.fn() }));
const { fetchFlairStatus } = vi.hoisted(() => ({ fetchFlairStatus: vi.fn() }));

vi.mock("~/client/api/airHandlersApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/airHandlersApi")>();
  return { ...actual, fetchAirHandlers, fetchAirHandlerTickDecision };
});
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, fetchZones };
});
vi.mock("~/client/api/controlApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/controlApi")>();
  return { ...actual, fetchFlairStatus };
});

const { default: DiagnosticsPage } =
  await import("~/client/components/diagnostics/DiagnosticsPage");

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

function renderPage() {
  return render(
    <ThemeProvider theme={theme}>
      <DiagnosticsPage />
    </ThemeProvider>,
  );
}

describe("DiagnosticsPage", () => {
  beforeEach(() => {
    fetchAirHandlers.mockReset().mockResolvedValue([AIR_HANDLER]);
    fetchZones.mockReset().mockResolvedValue([ZONE]);
    fetchAirHandlerTickDecision.mockReset().mockResolvedValue(null);
    fetchFlairStatus.mockReset().mockResolvedValue({
      outage: { failing: false, sinceMs: null },
      tokenRefreshFailure: null,
      tokenCallsToday: 1,
      tokenDailyBudget: 50,
    });
  });

  it("fetches every data source and composes all five diagnostic panels", async () => {
    renderPage();

    expect(await screen.findByText("Diagnostics")).toBeInTheDocument();
    expect(await screen.findByText("Martin Bedroom")).toBeInTheDocument(); // StalenessMonitor
    expect(
      await screen.findByText("No vents are currently degraded."),
    ).toBeInTheDocument(); // DegradedVentHistory
    expect(
      await screen.findByText("Martin Bedroom — Vent 1"),
    ).toBeInTheDocument(); // HardwareDiagnostics
    expect(await screen.findByText("Upstairs")).toBeInTheDocument(); // EquipmentFaultLog
    expect(await screen.findByText("Healthy")).toBeInTheDocument(); // FlairConnection

    expect(fetchAirHandlers).toHaveBeenCalledTimes(1);
    expect(fetchZones).toHaveBeenCalledTimes(1);
    expect(fetchFlairStatus).toHaveBeenCalledTimes(1);
    expect(fetchAirHandlerTickDecision).toHaveBeenCalledWith("ah-1");
  });

  it("shows a loading spinner before the initial fetch resolves", () => {
    renderPage();
    expect(screen.queryByText("Diagnostics")).not.toBeInTheDocument();
  });
});
