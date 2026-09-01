/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import type { AirHandler } from "~/client/api/airHandlersApi";
import type { Zone } from "~/client/api/zonesApi";

afterEach(cleanup);

const { fetchAirHandlers, fetchAirHandlerTickDecision } = vi.hoisted(() => ({
  fetchAirHandlers: vi.fn(),
  fetchAirHandlerTickDecision: vi.fn(),
}));
const { fetchZones } = vi.hoisted(() => ({ fetchZones: vi.fn() }));
const { fetchOverrides } = vi.hoisted(() => ({ fetchOverrides: vi.fn() }));
const { fetchSettings } = vi.hoisted(() => ({ fetchSettings: vi.fn() }));

vi.mock("~/client/api/airHandlersApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/airHandlersApi")>();
  return { ...actual, fetchAirHandlers, fetchAirHandlerTickDecision };
});
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, fetchZones };
});
vi.mock("~/client/api/overridesApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/overridesApi")>();
  return { ...actual, fetchOverrides };
});
vi.mock("~/client/api/settingsApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/settingsApi")>();
  return { ...actual, fetchSettings };
});

const { default: DashboardPage } =
  await import("~/client/components/dashboard/DashboardPage");
const { lightStatusPalette } = await import("~/client/theme/statusPalette");

const theme = createTheme({
  palette: { mode: "light", status: lightStatusPalette },
});

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

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: "z1",
    installationId: "inst-1",
    airHandlerId: "ah-1",
    flairRoomId: null,
    name: "Bedroom",
    ventHardwareType: "flair_smart_vent",
    config: {
      has_temperature_sensor: true,
      has_occupancy_sensor: false,
      thermal_load_flags: [],
      idle_baseline_position: 100,
      sensor_calibration_offset: 0,
      min_vent_position: 0,
      max_vent_position: 100,
      flair_vent_ids: ["vent-1"],
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
    ...overrides,
  };
}

function renderDashboard() {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <DashboardPage />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("DashboardPage", () => {
  beforeEach(() => {
    fetchAirHandlers.mockReset();
    fetchAirHandlerTickDecision.mockReset().mockResolvedValue(null);
    fetchZones.mockReset().mockResolvedValue([]);
    fetchOverrides.mockReset().mockResolvedValue([]);
    fetchSettings.mockReset().mockResolvedValue({
      control_disarmed: false,
      live_air_handler_ids: [],
    });
  });

  it("shows a message and a disabled 'Add zone' button when there are no air handlers yet", async () => {
    fetchAirHandlers.mockResolvedValue([]);
    renderDashboard();

    await screen.findByText("No air handlers configured yet.");
    expect(screen.getByRole("button", { name: "Add zone" })).toBeDisabled();
  });

  it("renders an air handler card and its zones once loaded", async () => {
    fetchAirHandlers.mockResolvedValue([AIR_HANDLER]);
    fetchZones.mockResolvedValue([makeZone()]);
    renderDashboard();

    await screen.findByText("Upstairs");
    expect(screen.getByText("Bedroom")).toBeInTheDocument();
    expect(fetchAirHandlerTickDecision).toHaveBeenCalledWith("ah-1");
  });

  it("opens the Add air handler dialog from the toolbar button", async () => {
    fetchAirHandlers.mockResolvedValue([]);
    renderDashboard();

    await screen.findByText("No air handlers configured yet.");
    fireEvent.click(screen.getByRole("button", { name: "Add air handler" }));
    expect(
      screen.getByRole("heading", { name: "Add air handler" }),
    ).toBeInTheDocument();
  });

  it("opens the zone detail dialog for the clicked zone's Edit button", async () => {
    fetchAirHandlers.mockResolvedValue([AIR_HANDLER]);
    fetchZones.mockResolvedValue([makeZone({ name: "Bedroom" })]);
    renderDashboard();

    await screen.findByText("Bedroom");
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("Bedroom — configuration")).toBeInTheDocument();
  });
});
