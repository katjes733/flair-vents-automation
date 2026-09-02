/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import type { AirHandler } from "~/client/api/airHandlersApi";
import type { Zone } from "~/client/api/zonesApi";

afterEach(cleanup);

const {
  fetchAirHandlers,
  fetchAirHandlerTickDecision,
  fetchAvailableFlairZones,
} = vi.hoisted(() => ({
  fetchAirHandlers: vi.fn(),
  fetchAirHandlerTickDecision: vi.fn(),
  // Mounting AddAirHandlerDialog/EditAirHandlerDialog open also mounts
  // FlairZoneSelect, which calls this on its own — stub it so this test
  // file never makes a real network call for it.
  fetchAvailableFlairZones: vi.fn(),
}));
const { fetchZones, updateZone } = vi.hoisted(() => ({
  fetchZones: vi.fn(),
  updateZone: vi.fn(),
}));
const { fetchOverrides } = vi.hoisted(() => ({ fetchOverrides: vi.fn() }));
const { fetchSettings } = vi.hoisted(() => ({ fetchSettings: vi.fn() }));

vi.mock("~/client/api/airHandlersApi", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/client/api/airHandlersApi")>();
  return {
    ...actual,
    fetchAirHandlers,
    fetchAirHandlerTickDecision,
    fetchAvailableFlairZones,
  };
});
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, fetchZones, updateZone };
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
    fetchAvailableFlairZones.mockReset().mockResolvedValue([]);
    fetchZones.mockReset().mockResolvedValue([]);
    updateZone.mockReset().mockResolvedValue({});
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
    // Two "Edit" buttons now render on this page: the air handler's own
    // (added alongside its Delete capability) and the zone's — the zone's
    // is the one inside its ZoneCard, rendered after the air handler's.
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[editButtons.length - 1]);
    expect(screen.getByText("Bedroom — configuration")).toBeInTheDocument();
  });

  // Regression test for a real, user-reported bug: editing a zone (e.g.
  // changing its vent hardware type) didn't refresh immediately — it
  // only caught up on a later poll. Root cause: loadAll() had no
  // sequencing, so an earlier-started refresh that happens to resolve
  // *after* a later-started one silently overwrites the newer data with
  // stale data, since whichever response simply *arrives* last wins the
  // setState calls regardless of which one was *started* last. Reproduced
  // here with two overlapping saves rather than faking the real 15s poll
  // timer, which is equivalent for this purpose (both are just "a second
  // loadAll() call started before the first one's response arrives") and
  // avoids the flakiness of mixing fake timers with RTL's async queries.
  it("discards an earlier save's stale response when it resolves after a newer save", async () => {
    fetchAirHandlers.mockResolvedValue([AIR_HANDLER]);

    let resolveFirstSaveRefresh: (zones: Zone[]) => void = () => {};
    const firstSaveRefresh = new Promise<Zone[]>((resolve) => {
      resolveFirstSaveRefresh = resolve;
    });

    fetchZones
      .mockResolvedValueOnce([makeZone({ name: "Bedroom" })]) // initial load
      .mockReturnValueOnce(firstSaveRefresh) // 1st save's own refresh — held pending
      .mockResolvedValueOnce([makeZone({ name: "Bedroom (edited twice)" })]); // 2nd save's refresh

    renderDashboard();
    await screen.findByText("Bedroom");

    // First save: its own loadAll() starts (fetchZones call #2) but
    // won't resolve until we let it later.
    const editButtons = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editButtons[editButtons.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Second save, started while the first save's refresh is still in
    // flight: its own loadAll() (fetchZones call #3) resolves right away.
    const editButtonsAgain = await screen.findAllByRole("button", {
      name: "Edit",
    });
    fireEvent.click(editButtonsAgain[editButtonsAgain.length - 1]);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Bedroom (edited twice)");

    // Now the first save's refresh finally resolves with data that's
    // stale relative to the second save — it must not win. Give its
    // promise chain (Promise.all → setState → re-render) real time to
    // actually run before asserting, or this would pass trivially even
    // with the bug present, having never let the overwrite happen.
    resolveFirstSaveRefresh([makeZone({ name: "Bedroom" })]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByText("Bedroom (edited twice)")).toBeInTheDocument();
    expect(screen.queryByText("Bedroom")).not.toBeInTheDocument();
  });
});
