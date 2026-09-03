/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import type { Zone } from "~/client/api/zonesApi";
import type { ZoneTickDecisionRecord } from "~/client/api/airHandlersApi";

afterEach(cleanup);

const { updateZone, deleteZone } = vi.hoisted(() => ({
  updateZone: vi.fn(),
  deleteZone: vi.fn(),
}));
vi.mock("~/client/api/zonesApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/client/api/zonesApi")>();
  return { ...actual, updateZone, deleteZone };
});

const { default: ZoneDetailDialog } =
  await import("~/client/components/dashboard/ZoneDetailDialog");

const theme = createTheme();

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

function renderDialog(
  zone: Zone | null,
  onSaved = vi.fn(),
  onClose = vi.fn(),
  onDeleted = vi.fn(),
  tickRecord?: ZoneTickDecisionRecord,
) {
  return render(
    <ThemeProvider theme={theme}>
      <NotificationProvider>
        <ZoneDetailDialog
          open
          zone={zone}
          tickRecord={tickRecord}
          onClose={onClose}
          onSaved={onSaved}
          onDeleted={onDeleted}
        />
      </NotificationProvider>
    </ThemeProvider>,
  );
}

describe("ZoneDetailDialog", () => {
  beforeEach(() => {
    updateZone.mockReset().mockResolvedValue({});
    deleteZone.mockReset().mockResolvedValue(undefined);
  });

  it("renders nothing when no zone is selected", () => {
    const { container } = renderDialog(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("seeds the form from the zone's existing config", () => {
    renderDialog(
      makeZone({
        config: {
          has_temperature_sensor: true,
          has_occupancy_sensor: false,
          thermal_load_flags: [],
          idle_baseline_position: 80,
          comfort_tolerance: 1.5,
          sensor_calibration_offset: 0.5,
          min_vent_position: 10,
          max_vent_position: 90,
          flair_vents: [{ flair_vent_id: "vent-1" }],
          manual_vents: [],
          display_order: 0,
        },
      }),
    );
    expect(screen.getByLabelText("Idle baseline (0–100%)")).toHaveValue(80);
    expect(screen.getByLabelText(/Comfort tolerance/)).toHaveValue(1.5);
    expect(screen.getByLabelText(/Sensor calibration offset/)).toHaveValue(0.5);
  });

  it("hides position fields for a no_vent zone", () => {
    renderDialog(
      makeZone({
        ventHardwareType: "no_vent",
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
      }),
    );
    expect(
      screen.queryByLabelText("Idle baseline (0–100%)"),
    ).not.toBeInTheDocument();
  });

  it("saves the edited config and calls onSaved", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    renderDialog(makeZone(), onSaved, onClose);
    fireEvent.change(screen.getByLabelText("Idle baseline (0–100%)"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith(
        "z1",
        expect.objectContaining({
          config: expect.objectContaining({ idle_baseline_position: 60 }),
        }),
      );
      expect(onSaved).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("treats a blank comfort tolerance as unset, not zero", async () => {
    renderDialog(
      makeZone({ config: { ...makeZone().config, comfort_tolerance: 2 } }),
    );
    fireEvent.change(screen.getByLabelText(/Comfort tolerance/), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith(
        "z1",
        expect.objectContaining({
          config: expect.objectContaining({ comfort_tolerance: undefined }),
        }),
      );
    });
  });

  // Regression coverage for making vent_hardware_type editable after
  // creation/import — previously fixed at whatever it was set to
  // originally (e.g. `no_vent` for a sync-imported, sensor-only Flair
  // room), with no way to convert it via this dialog at all.
  it("seeds the vent hardware type selector from the zone's current type", () => {
    renderDialog(makeZone({ ventHardwareType: "no_vent" }));
    expect(
      screen.getByRole("combobox", { name: "Vent hardware type" }),
    ).toHaveTextContent("No vent");
  });

  it("switching to manual fixed vent reveals a vent-position field and requires it before Save", async () => {
    const user = userEvent.setup();
    renderDialog(makeZone({ ventHardwareType: "no_vent" }));
    expect(screen.queryByLabelText("Position 1")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("combobox", { name: "Vent hardware type" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "Manual fixed vent" }),
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Position 1"), {
      target: { value: "40" },
    });
    expect(screen.getByRole("button", { name: "Save" })).not.toBeDisabled();
  });

  // Regression coverage for a real house-specific correction:
  // manual_fixed_vent used to be blocked for any zone linked to a live
  // Flair room (flairRoomId !== null), on the theory that a manual vent
  // has no reason to track live Flair sensor data. That's wrong — a
  // room's vent can be a plain, non-Flair-controlled one while its
  // temperature/occupancy still comes from a real, Flair-tracked remote
  // sensor (confirmed for two real rooms in the house this app runs in).
  // flair_room_id only ever anchors sensor data, independent of vent
  // hardware, so every option must stay selectable regardless of the
  // Flair link.
  it("allows converting to manual fixed vent even while linked to a Flair room", async () => {
    const user = userEvent.setup();
    renderDialog(
      makeZone({ ventHardwareType: "no_vent", flairRoomId: "room-1" }),
    );
    await user.click(
      screen.getByRole("combobox", { name: "Vent hardware type" }),
    );
    const option = await screen.findByRole("option", {
      name: "Manual fixed vent",
    });
    expect(option).not.toHaveAttribute("aria-disabled", "true");
    await user.click(option);
    expect(screen.getByLabelText("Position 1")).toBeInTheDocument();
  });

  it("switching away from manual_fixed_vent clears manual_vents rather than leaving it stale", async () => {
    const user = userEvent.setup();
    renderDialog(
      makeZone({
        ventHardwareType: "manual_fixed_vent",
        config: {
          ...makeZone().config,
          manual_vents: [{ position: 25 }],
        },
      }),
    );
    await user.click(
      screen.getByRole("combobox", { name: "Vent hardware type" }),
    );
    await user.click(await screen.findByRole("option", { name: "No vent" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith(
        "z1",
        expect.objectContaining({
          vent_hardware_type: "no_vent",
          config: expect.objectContaining({ manual_vents: [] }),
        }),
      );
    });
  });

  // Regression coverage for modeling a real gap: a manual_fixed_vent
  // zone's vents can each sit at a genuinely different position (a real
  // house confirmed both its bathrooms and its Den back each have 2 — see
  // manual_vents in zoneConfig.ts).
  it("seeds each vent's own position from the zone's existing manual_vents and submits an edited value", async () => {
    renderDialog(
      makeZone({
        ventHardwareType: "manual_fixed_vent",
        config: {
          ...makeZone().config,
          manual_vents: [{ position: 75 }, { position: 25 }],
        },
      }),
    );
    expect(screen.getByLabelText("Position 1")).toHaveValue(75);
    expect(screen.getByLabelText("Position 2")).toHaveValue(25);

    fireEvent.change(screen.getByLabelText("Position 2"), {
      target: { value: "60" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith(
        "z1",
        expect.objectContaining({
          config: expect.objectContaining({
            manual_vents: [{ position: 75 }, { position: 60 }],
          }),
        }),
      );
    });
  });

  it("adds and removes a manual vent row via the repeatable field", async () => {
    const user = userEvent.setup();
    renderDialog(
      makeZone({
        ventHardwareType: "manual_fixed_vent",
        config: { ...makeZone().config, manual_vents: [{ position: 75 }] },
      }),
    );
    await user.click(screen.getByRole("button", { name: "Add another vent" }));
    fireEvent.change(screen.getByLabelText("Position 2"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith(
        "z1",
        expect.objectContaining({
          config: expect.objectContaining({
            manual_vents: [{ position: 75 }, { position: 30 }],
          }),
        }),
      );
    });
  });

  // Regression coverage for extending per-vent duct ratings from manual
  // vents to flair_smart_vent zones (see "Multi-Vent Manual Zones"): each
  // vent carries its own id and (optional) rating rather than one shared
  // zone-level combined number.
  it("seeds each flair vent's own rating (id is read-only, ordinal-labeled) and submits an edited rating", async () => {
    renderDialog(
      makeZone({
        config: {
          ...makeZone().config,
          flair_vents: [
            { flair_vent_id: "vent-a", duct_flow_rate_lps: 94.4 },
            { flair_vent_id: "vent-b" },
          ],
        },
      }),
    );
    expect(screen.getByText("Vent 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Rating 1, L/s")).toHaveValue(94.4);
    expect(screen.getByText("Vent 2")).toBeInTheDocument();
    expect(screen.queryByLabelText("Flair vent ID 1")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Rating 2, L/s"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() => {
      expect(updateZone).toHaveBeenCalledWith(
        "z1",
        expect.objectContaining({
          config: expect.objectContaining({
            flair_vents: [
              { flair_vent_id: "vent-a", duct_flow_rate_lps: 94.4 },
              { flair_vent_id: "vent-b", duct_flow_rate_lps: 50 },
            ],
          }),
        }),
      );
    });
  });

  // Regression coverage: unlike manual vents, a Flair vent's id is Flair's
  // own opaque identifier — not something a user would type from memory —
  // so this dialog deliberately offers no way to add a second row for a
  // flair_smart_vent zone, even when editing one that already has vents.
  // See RepeatableFlairVentField's own comment.
  it("does not offer 'Add another vent' for a flair_smart_vent zone", () => {
    renderDialog(
      makeZone({
        config: {
          ...makeZone().config,
          flair_vents: [{ flair_vent_id: "vent-a" }],
        },
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Add another vent" }),
    ).not.toBeInTheDocument();
  });

  // Regression coverage for the "pick a vent size" ergonomics improvement
  // (see docs/hvac-pressure-research.md's "Register Size to Airflow
  // Rating"): choosing a size autofills the rating field with that size's
  // real, sourced rated-max flow — but the field stays freely editable
  // afterward, since a real register may not match its nominal size
  // exactly.
  it("autofills a vent's airflow rating from a picked size, still overridable", async () => {
    const user = userEvent.setup();
    renderDialog(
      makeZone({
        config: { ...makeZone().config, flair_vents: [{ flair_vent_id: "a" }] },
      }),
    );
    await user.click(screen.getByRole("combobox", { name: "Vent size" }));
    await user.click(await screen.findByRole("option", { name: "8x8" }));
    expect(screen.getByLabelText("Rating 1, L/s")).toHaveValue(94.4);

    fireEvent.change(screen.getByLabelText("Rating 1, L/s"), {
      target: { value: "80" },
    });
    expect(screen.getByLabelText("Rating 1, L/s")).toHaveValue(80);
  });

  // Regression coverage for "use the nickname over the raw id" — mirrors
  // how ZoneCard/TickDecisionInspector already prefer a vent's real Flair
  // nickname over its opaque id everywhere else it's shown.
  it("displays a flair vent's real nickname as read-only text when the latest tick decision knows one", () => {
    renderDialog(
      makeZone({
        config: {
          ...makeZone().config,
          flair_vents: [{ flair_vent_id: "vent-a" }],
        },
      }),
      vi.fn(),
      vi.fn(),
      vi.fn(),
      {
        zone_id: "z1",
        name: "Bedroom",
        vent_hardware_type: "flair_smart_vent",
        classification: "demanding",
        occupied: false,
        spiking: false,
        resolved_setpoint: null,
        desired_position_pct: 100,
        post_contention_position_pct: 100,
        reason: "",
        vents: [
          {
            flair_vent_id: "vent-a",
            name: "Den Center South",
            commanded_position_pct: 100,
            reported_position_pct: 100,
            dispatch_decision: "dispatched",
            degraded: false,
            voltage: null,
            current_rssi: null,
          },
        ],
      },
    );
    expect(screen.getByText("Den Center South")).toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Den Center South" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Flair vent ID 1")).not.toBeInTheDocument();
  });

  it("requires an explicit confirm before deleting", async () => {
    const onDeleted = vi.fn();
    renderDialog(makeZone(), vi.fn(), vi.fn(), onDeleted);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteZone).not.toHaveBeenCalled();

    const confirmButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    await vi.waitFor(() => {
      expect(deleteZone).toHaveBeenCalledWith("z1");
      expect(onDeleted).toHaveBeenCalled();
    });
  });

  it("shows the referential-refusal error and doesn't call onDeleted", async () => {
    deleteZone.mockRejectedValue({
      response: { data: { error: "still referenced by schedule Night" } },
    });
    const onDeleted = vi.fn();
    renderDialog(makeZone(), vi.fn(), vi.fn(), onDeleted);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const confirmButtons = screen.getAllByRole("button", { name: "Delete" });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);

    expect(
      await screen.findByText(/still referenced by schedule Night/),
    ).toBeInTheDocument();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
