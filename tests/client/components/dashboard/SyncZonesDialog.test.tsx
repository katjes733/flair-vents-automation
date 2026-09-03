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

const { triggerTick } = vi.hoisted(() => ({ triggerTick: vi.fn() }));
vi.mock("~/client/api/controlApi", () => ({ triggerTick }));

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
    triggerTick.mockReset().mockResolvedValue(undefined);
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
      expect(linkRoomToZone).toHaveBeenCalledWith(
        "ah-1",
        "room-2",
        "z1",
        undefined,
      );
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
          liveVentIds: ["vent-3"],
          hasTemperatureSensor: true,
          hasOccupancySensor: false,
        },
      ],
    });
    renderDialog();
    await screen.findByText("Attic");
    expect(createZoneFromRoom).not.toHaveBeenCalled();

    runSync.mockResolvedValue({ applied: [], unmatched: [] });
    fireEvent.click(screen.getByRole("button", { name: "Import as new zone" }));
    await vi.waitFor(() => {
      expect(createZoneFromRoom).toHaveBeenCalledWith(
        "ah-1",
        "room-3",
        "Attic",
        undefined,
      );
    });
  });

  // Fixtures below use a real vent id — these tests are about bulk-select
  // and tick-triggering mechanics, not the fixed-position requirement
  // (covered by its own dedicated tests further down), so a vent-having
  // room keeps them simple and unaffected by that gate.
  const TWO_UNMATCHED = [
    {
      kind: "unmatched_new" as const,
      flairRoomId: "room-a",
      name: "Attic",
      liveVentIds: ["vent-a"],
      hasTemperatureSensor: true,
      hasOccupancySensor: false,
    },
    {
      kind: "unmatched_new" as const,
      flairRoomId: "room-b",
      name: "Basement",
      liveVentIds: ["vent-b"],
      hasTemperatureSensor: true,
      hasOccupancySensor: false,
    },
  ];

  it("defaults every unmatched room to selected, and imports all of them on one click", async () => {
    runSync.mockResolvedValue({ applied: [], unmatched: TWO_UNMATCHED });
    renderDialog();
    await screen.findByText("2 of 2 selected");

    runSync.mockResolvedValue({ applied: [], unmatched: [] });
    fireEvent.click(
      screen.getByRole("button", { name: "Import selected (2)" }),
    );
    await vi.waitFor(() => {
      expect(createZoneFromRoom).toHaveBeenCalledWith(
        "ah-1",
        "room-a",
        "Attic",
        undefined,
      );
      expect(createZoneFromRoom).toHaveBeenCalledWith(
        "ah-1",
        "room-b",
        "Basement",
        undefined,
      );
    });
  });

  it("unchecking one room excludes it from the bulk import", async () => {
    runSync.mockResolvedValue({ applied: [], unmatched: TWO_UNMATCHED });
    renderDialog();
    await screen.findByText("2 of 2 selected");

    fireEvent.click(screen.getByRole("checkbox", { name: "Attic" }));
    await screen.findByText("1 of 2 selected");

    runSync.mockResolvedValue({ applied: [], unmatched: [] });
    fireEvent.click(
      screen.getByRole("button", { name: "Import selected (1)" }),
    );
    await vi.waitFor(() => {
      expect(createZoneFromRoom).toHaveBeenCalledWith(
        "ah-1",
        "room-b",
        "Basement",
        undefined,
      );
      expect(createZoneFromRoom).not.toHaveBeenCalledWith(
        "ah-1",
        "room-a",
        "Attic",
      );
    });
  });

  it("select-all toggles every room off, then back on", async () => {
    runSync.mockResolvedValue({ applied: [], unmatched: TWO_UNMATCHED });
    renderDialog();
    await screen.findByText("2 of 2 selected");

    const selectAll = screen.getByRole("checkbox", {
      name: "2 of 2 selected",
    });
    fireEvent.click(selectAll);
    await screen.findByText("0 of 2 selected");
    expect(
      screen.getByRole("button", { name: /Import selected/ }),
    ).toBeDisabled();

    fireEvent.click(selectAll);
    await screen.findByText("2 of 2 selected");
  });

  it("forces an immediate tick after a single-room import, before refreshing", async () => {
    runSync.mockResolvedValue({
      applied: [],
      unmatched: [
        {
          kind: "unmatched_new",
          flairRoomId: "room-3",
          name: "Attic",
          liveVentIds: ["vent-3"],
          hasTemperatureSensor: true,
          hasOccupancySensor: false,
        },
      ],
    });
    renderDialog();
    await screen.findByText("Attic");

    runSync.mockResolvedValue({ applied: [], unmatched: [] });
    fireEvent.click(screen.getByRole("button", { name: "Import as new zone" }));
    await vi.waitFor(() => {
      expect(triggerTick).toHaveBeenCalledOnce();
    });
  });

  it("forces exactly one immediate tick for a bulk import, not one per room", async () => {
    runSync.mockResolvedValue({ applied: [], unmatched: TWO_UNMATCHED });
    renderDialog();
    await screen.findByText("2 of 2 selected");

    runSync.mockResolvedValue({ applied: [], unmatched: [] });
    fireEvent.click(
      screen.getByRole("button", { name: "Import selected (2)" }),
    );
    await vi.waitFor(() => {
      expect(createZoneFromRoom).toHaveBeenCalledTimes(2);
      expect(triggerTick).toHaveBeenCalledOnce();
    });
  });

  it("still refreshes and shows success even if the tick trigger itself fails", async () => {
    triggerTick.mockRejectedValue(new Error("tick failed"));
    runSync.mockResolvedValue({
      applied: [],
      unmatched: [
        {
          kind: "unmatched_new",
          flairRoomId: "room-3",
          name: "Attic",
          liveVentIds: ["vent-3"],
          hasTemperatureSensor: true,
          hasOccupancySensor: false,
        },
      ],
    });
    renderDialog();
    await screen.findByText("Attic");

    runSync.mockResolvedValue({ applied: [], unmatched: [] });
    fireEvent.click(screen.getByRole("button", { name: "Import as new zone" }));
    expect(await screen.findByText(/No unmatched rooms/)).toBeInTheDocument();
  });

  // Regression coverage for the reversed import default (see
  // syncService.ts): a room with zero live vents now resolves to
  // manual_fixed_vent, which requires a fixed position — never guessed by
  // this dialog, since there's no real physical value to infer it from.
  describe("fixed position for a vent-less room", () => {
    const ZERO_VENT_UNMATCHED = {
      kind: "unmatched_new" as const,
      flairRoomId: "room-4",
      name: "Office",
      liveVentIds: [],
      hasTemperatureSensor: true,
      hasOccupancySensor: false,
    };

    it("requires a fixed position before Import as new zone is enabled", async () => {
      runSync.mockResolvedValue({
        applied: [],
        unmatched: [ZERO_VENT_UNMATCHED],
      });
      renderDialog();
      await screen.findByText("Office");
      expect(
        screen.getByRole("button", { name: "Import as new zone" }),
      ).toBeDisabled();

      fireEvent.change(screen.getByLabelText("Fixed position (0–100%)"), {
        target: { value: "35" },
      });
      expect(
        screen.getByRole("button", { name: "Import as new zone" }),
      ).not.toBeDisabled();

      runSync.mockResolvedValue({ applied: [], unmatched: [] });
      fireEvent.click(
        screen.getByRole("button", { name: "Import as new zone" }),
      );
      await vi.waitFor(() => {
        expect(createZoneFromRoom).toHaveBeenCalledWith(
          "ah-1",
          "room-4",
          "Office",
          35,
        );
      });
    });

    it("requires a fixed position before Link is enabled", async () => {
      runSync.mockResolvedValue({
        applied: [],
        unmatched: [ZERO_VENT_UNMATCHED],
      });
      renderDialog([
        makeZone({ id: "z1", name: "Some other zone", flairRoomId: null }),
      ]);
      await screen.findByText("Office");
      fireEvent.mouseDown(
        screen.getByRole("combobox", { name: "Link to zone" }),
      );
      fireEvent.click(
        await screen.findByRole("option", { name: "Some other zone" }),
      );
      expect(screen.getByRole("button", { name: "Link" })).toBeDisabled();

      fireEvent.change(screen.getByLabelText("Fixed position (0–100%)"), {
        target: { value: "20" },
      });
      expect(screen.getByRole("button", { name: "Link" })).not.toBeDisabled();

      runSync.mockResolvedValue({ applied: [], unmatched: [] });
      fireEvent.click(screen.getByRole("button", { name: "Link" }));
      await vi.waitFor(() => {
        expect(linkRoomToZone).toHaveBeenCalledWith("ah-1", "room-4", "z1", 20);
      });
    });

    it("blocks bulk Import selected while a selected vent-less room lacks a fixed position", async () => {
      runSync.mockResolvedValue({
        applied: [],
        unmatched: [ZERO_VENT_UNMATCHED],
      });
      renderDialog();
      await screen.findByText("1 of 1 selected");
      expect(
        screen.getByRole("button", { name: /Import selected/ }),
      ).toBeDisabled();

      fireEvent.change(screen.getByLabelText("Fixed position (0–100%)"), {
        target: { value: "50" },
      });
      expect(
        screen.getByRole("button", { name: /Import selected/ }),
      ).not.toBeDisabled();
    });
  });
});
