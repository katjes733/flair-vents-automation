/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const { fetchHomeKitStatus, fetchHomeKitSensorMatches } = vi.hoisted(() => ({
  fetchHomeKitStatus: vi.fn(),
  fetchHomeKitSensorMatches: vi.fn(),
}));
vi.mock("~/client/api/homekitApi", () => ({
  fetchHomeKitStatus,
  fetchHomeKitSensorMatches,
}));

const { fetchZones, updateZone } = vi.hoisted(() => ({
  fetchZones: vi.fn(),
  updateZone: vi.fn(),
}));
vi.mock("~/client/api/zonesApi", () => ({ fetchZones, updateZone }));

const { useSession } = vi.hoisted(() => ({ useSession: vi.fn() }));
vi.mock("~/client/session/useSession", () => ({ useSession }));

const { default: HomeKitSensorMatchDialog } =
  await import("~/client/components/dashboard/HomeKitSensorMatchDialog");

const theme = createTheme();

function zone(overrides: Record<string, unknown> = {}) {
  return {
    id: "z1",
    installationId: "inst-1",
    airHandlerId: "ah-1",
    flairRoomId: "room-1",
    name: "Martin Office",
    ventHardwareType: "flair_smart_vent",
    config: { homekit_sensor_serial: null },
    state: {},
    ...overrides,
  };
}

function renderDialog(onClose = vi.fn(), onMatched = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <HomeKitSensorMatchDialog
          open
          airHandlerId="ah-1"
          airHandlerName="Upstairs"
          onClose={onClose}
          onMatched={onMatched}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("HomeKitSensorMatchDialog", () => {
  beforeEach(() => {
    useSession.mockReturnValue({ user: { profile: "admin", role: "owner" } });
    fetchHomeKitStatus.mockReset();
    fetchHomeKitSensorMatches.mockReset();
    fetchZones.mockReset().mockResolvedValue([]);
    updateZone.mockReset().mockResolvedValue({});
  });

  it("shows a 'not paired yet' message instead of any sensor list when unpaired", async () => {
    fetchHomeKitStatus.mockResolvedValue({ paired: false });
    fetchHomeKitSensorMatches.mockResolvedValue([]);
    renderDialog();
    expect(
      await screen.findByText(/Not paired with HomeKit yet/),
    ).toBeInTheDocument();
  });

  it("shows an empty-state message when paired but no SmartSensor accessories are found", async () => {
    fetchHomeKitStatus.mockResolvedValue({ paired: true });
    fetchHomeKitSensorMatches.mockResolvedValue([]);
    renderDialog();
    expect(
      await screen.findByText(/No SmartSensor accessories found/),
    ).toBeInTheDocument();
  });

  it("renders an already-mapped sensor with an Unmap action that clears the mapping", async () => {
    fetchHomeKitStatus.mockResolvedValue({ paired: true });
    fetchHomeKitSensorMatches.mockResolvedValue([
      {
        kind: "already_mapped",
        serial: "Y3H2",
        name: "Martin Office",
        tempC: 22,
        occupied: false,
        zoneId: "z1",
        zoneName: "Martin Office",
      },
    ]);
    fetchZones.mockResolvedValue([zone()]);
    renderDialog();

    expect(await screen.findByText(/Mapped to/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Unmap" }));

    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith("z1", {
        config: { homekit_sensor_serial: null },
      });
    });
  });

  it("pre-fills the suggested zone for an unmapped_suggested entry and confirms it on click", async () => {
    fetchHomeKitStatus.mockResolvedValue({ paired: true });
    fetchHomeKitSensorMatches.mockResolvedValue([
      {
        kind: "unmapped_suggested",
        serial: "Y22S",
        name: "Martin Bedroom",
        tempC: 23,
        occupied: true,
        suggestedZoneId: "z2",
        suggestedZoneName: "Martin Bedroom",
      },
    ]);
    fetchZones.mockResolvedValue([zone({ id: "z2", name: "Martin Bedroom" })]);
    renderDialog();

    expect(
      await screen.findByText("Suggested match found"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith("z2", {
        config: { homekit_sensor_serial: "Y22S" },
      });
    });
  });

  it("requires an explicit zone selection before Confirm is enabled for an unmatched (no name match) entry", async () => {
    fetchHomeKitStatus.mockResolvedValue({ paired: true });
    fetchHomeKitSensorMatches.mockResolvedValue([
      {
        kind: "unmapped_new",
        serial: "TB7M",
        name: "Extra Den",
        tempC: 23.5,
        occupied: true,
      },
    ]);
    fetchZones.mockResolvedValue([
      zone({ id: "z3", name: "Den back" }),
      zone({ id: "z4", name: "Den Front" }),
    ]);
    renderDialog();

    await screen.findByText("Extra Den");
    const confirmButton = screen.getByRole("button", { name: "Confirm" });
    expect(confirmButton).toBeDisabled();

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Map to zone" }));
    fireEvent.click(await screen.findByRole("option", { name: "Den back" }));
    expect(confirmButton).not.toBeDisabled();

    fireEvent.click(confirmButton);
    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith("z3", {
        config: { homekit_sensor_serial: "TB7M" },
      });
    });
  });
});
