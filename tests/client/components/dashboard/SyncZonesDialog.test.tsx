/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import type { Zone } from "~/client/api/zonesApi";

afterEach(cleanup);

const { runSync, linkRoomToZone, createZoneFromRoom } = vi.hoisted(() => ({
  runSync: vi.fn(),
  linkRoomToZone: vi.fn(),
  createZoneFromRoom: vi.fn(),
}));
vi.mock("~/client/api/syncApi", () => ({
  runSync,
  linkRoomToZone,
  createZoneFromRoom,
}));

const { default: SyncZonesDialog } =
  await import("~/client/components/dashboard/SyncZonesDialog");

const theme = createTheme();

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
    id: "z1",
    installationId: "inst-1",
    airHandlerId: "ah-1",
    flairRoomId: null,
    name: "Office",
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

function renderDialog(zones: Zone[] = [], onSynced = vi.fn()) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <SyncZonesDialog
          open
          airHandlerId="ah-1"
          zones={zones}
          onClose={vi.fn()}
          onSynced={onSynced}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("SyncZonesDialog", () => {
  beforeEach(() => {
    runSync.mockReset();
    linkRoomToZone.mockReset().mockResolvedValue({});
    createZoneFromRoom.mockReset().mockResolvedValue({});
  });

  it("shows the applied summary and 'no unmatched rooms' when everything is linked", async () => {
    runSync.mockResolvedValue({
      applied: [
        { kind: "matched_unchanged", zoneId: "z1", flairRoomId: "room-1" },
      ],
      unmatched: [],
    });
    renderDialog();
    await screen.findByText(/1 zone already in sync/);
    expect(screen.getByText(/No unmatched rooms/)).toBeInTheDocument();
  });

  it("shows a suggested-match chip for an unmatched room with a name match", async () => {
    runSync.mockResolvedValue({
      applied: [],
      unmatched: [
        {
          kind: "unmatched_suggested",
          flairRoomId: "room-2",
          name: "Garage",
          liveVentIds: ["vent-2"],
          hasTemperatureSensor: true,
          hasOccupancySensor: false,
          suggestedZoneId: "z1",
        },
      ],
    });
    renderDialog([makeZone({ id: "z1", name: "Garage", flairRoomId: null })]);
    expect(
      await screen.findByText("Suggested match found"),
    ).toBeInTheDocument();
  });

  it("shows no suggestion chip for an unmatched room with no name match", async () => {
    runSync.mockResolvedValue({
      applied: [],
      unmatched: [
        {
          kind: "unmatched_new",
          flairRoomId: "room-3",
          name: "Attic",
          liveVentIds: [],
          hasTemperatureSensor: true,
          hasOccupancySensor: false,
        },
      ],
    });
    renderDialog();
    await screen.findByText("Attic");
    expect(screen.queryByText("Suggested match found")).not.toBeInTheDocument();
  });

  it("only links a room after the explicit Link button click, never automatically", async () => {
    runSync.mockResolvedValue({
      applied: [],
      unmatched: [
        {
          kind: "unmatched_suggested",
          flairRoomId: "room-2",
          name: "Garage",
          liveVentIds: ["vent-2"],
          hasTemperatureSensor: true,
          hasOccupancySensor: false,
          suggestedZoneId: "z1",
        },
      ],
    });
    const onSynced = vi.fn();
    renderDialog(
      [makeZone({ id: "z1", name: "Garage", flairRoomId: null })],
      onSynced,
    );
    await screen.findByRole("button", { name: "Link" });
    expect(linkRoomToZone).not.toHaveBeenCalled();

    runSync.mockResolvedValue({ applied: [], unmatched: [] });
    fireEvent.click(screen.getByRole("button", { name: "Link" }));
    await vi.waitFor(() => {
      expect(linkRoomToZone).toHaveBeenCalledWith("ah-1", "room-2", "z1");
      expect(onSynced).toHaveBeenCalled();
    });
  });

  it("creates a new zone from an unmatched room's live data on click", async () => {
    runSync.mockResolvedValue({
      applied: [],
      unmatched: [
        {
          kind: "unmatched_new",
          flairRoomId: "room-3",
          name: "Attic",
          liveVentIds: [],
          hasTemperatureSensor: true,
          hasOccupancySensor: false,
        },
      ],
    });
    renderDialog();
    await screen.findByText("Attic");
    expect(createZoneFromRoom).not.toHaveBeenCalled();

    runSync.mockResolvedValue({ applied: [], unmatched: [] });
    fireEvent.click(screen.getByRole("button", { name: "Create new zone" }));
    await vi.waitFor(() => {
      expect(createZoneFromRoom).toHaveBeenCalledWith(
        "ah-1",
        "room-3",
        "Attic",
      );
    });
  });
});
