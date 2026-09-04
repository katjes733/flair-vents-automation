/** @vitest-environment jsdom */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ComponentProps } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Zone } from "~/client/api/zonesApi";

afterEach(cleanup);

const { revokeOverride } = vi.hoisted(() => ({ revokeOverride: vi.fn() }));
vi.mock("~/client/api/overridesApi", () => ({ revokeOverride }));

const { default: ZoneCard } =
  await import("~/client/components/dashboard/ZoneCard");
const { lightStatusPalette } = await import("~/client/theme/statusPalette");

const theme = createTheme({
  palette: { mode: "light", status: lightStatusPalette },
});

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

function renderCard(props: Partial<ComponentProps<typeof ZoneCard>> = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <ZoneCard
        zone={makeZone()}
        tickRecord={undefined}
        activeOverride={undefined}
        onChanged={vi.fn()}
        onEdit={vi.fn()}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe("ZoneCard", () => {
  it("shows the calibrated reading for a sensored zone", () => {
    renderCard();
    expect(screen.getByText("22.5°C")).toBeInTheDocument();
  });

  it("shows the fixed position for a manual vent instead of a reading", () => {
    renderCard({
      zone: makeZone({
        ventHardwareType: "manual_fixed_vent",
        config: {
          has_temperature_sensor: false,
          has_occupancy_sensor: false,
          manual_vents: [{ position: 40 }],
          thermal_load_flags: [],
          idle_baseline_position: 100,
          sensor_calibration_offset: 0,
          min_vent_position: 0,
          max_vent_position: 100,
          flair_vents: [],
          display_order: 0,
        },
      }),
    });
    expect(screen.getByText(/Manual fixed vent \(40%\)/)).toBeInTheDocument();
  });

  // Regression coverage for modeling a real gap: a manual_fixed_vent zone
  // can have more than one physical vent, each at a genuinely different
  // position (a real house confirmed both its bathrooms and its Den back
  // each have 2).
  it("shows each vent's own position for a manual vent zone with more than one vent", () => {
    renderCard({
      zone: makeZone({
        ventHardwareType: "manual_fixed_vent",
        config: {
          has_temperature_sensor: false,
          has_occupancy_sensor: false,
          manual_vents: [{ position: 75 }, { position: 25 }],
          thermal_load_flags: [],
          idle_baseline_position: 100,
          sensor_calibration_offset: 0,
          min_vent_position: 0,
          max_vent_position: 100,
          flair_vents: [],
          display_order: 0,
        },
      }),
    });
    expect(
      screen.getByText("Manual fixed vent (Vent 1): 75%"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Manual fixed vent (Vent 2): 25%"),
    ).toBeInTheDocument();
  });

  it("shows a degraded chip when the zone is degraded", () => {
    renderCard({
      zone: makeZone({
        state: {
          ...makeZone().state,
          vents: [
            {
              flair_vent_id: "vent-1",
              last_reported_position: null,
              degraded: true,
              degraded_since: "2024-01-01T00:00:00.000Z",
              reconcile_attempts: 3,
            },
          ],
        },
      }),
    });
    expect(screen.getByText("Degraded vent")).toBeInTheDocument();
  });

  it("offers 'Set manual override' for a controllable zone with no active override", () => {
    renderCard();
    expect(
      screen.getByRole("button", { name: "Set manual override" }),
    ).toBeInTheDocument();
  });

  it("offers 'Clear override' and revokes it on click when one is active", async () => {
    revokeOverride.mockResolvedValue(undefined);
    const onChanged = vi.fn();
    renderCard({
      activeOverride: {
        id: "mo-1",
        zoneId: "z1",
        config: {
          kind: "position",
          value: 50,
          hold_type: "2h",
          actor: "Martin",
        },
        createdAtMs: 0,
        expiresAtMs: null,
        revokedAtMs: null,
        active: true,
      },
      onChanged,
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear override" }));
    await vi.waitFor(() => {
      expect(revokeOverride).toHaveBeenCalledWith("mo-1");
      expect(onChanged).toHaveBeenCalled();
    });
  });

  it("does not offer manual override controls for a no_vent zone", () => {
    renderCard({
      zone: makeZone({
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
    });
    expect(
      screen.queryByRole("button", { name: "Set manual override" }),
    ).not.toBeInTheDocument();
  });

  it("calls onEdit with the zone when Edit is clicked", () => {
    const onEdit = vi.fn();
    const zone = makeZone();
    renderCard({ zone, onEdit });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(zone);
  });

  it("renders no reorder controls when the caller doesn't pass any", () => {
    renderCard();
    expect(
      screen.queryByRole("button", { name: /Move .* up/ }),
    ).not.toBeInTheDocument();
  });

  it("renders reorder controls inline in the header when the caller wires them up", () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    renderCard({ onMoveUp, onMoveDown, canMoveUp: true, canMoveDown: false });

    const up = screen.getByRole("button", { name: "Move Bedroom up" });
    const down = screen.getByRole("button", { name: "Move Bedroom down" });
    expect(up).not.toBeDisabled();
    expect(down).toBeDisabled();

    fireEvent.click(up);
    expect(onMoveUp).toHaveBeenCalled();
  });

  // Regression test: a multi-vent zone previously labeled each vent row
  // with its raw Flair vent id (a meaningless UUID to a user) — confirmed
  // live via a screenshot of a 3-vent zone. Ordinal labels ("Vent 1",
  // "Vent 2", ...) replace it.
  it("falls back to an ordinal label, not the raw Flair id, when a vent has no name yet", () => {
    renderCard({
      zone: makeZone({
        config: {
          ...makeZone().config,
          flair_vents: [
            { flair_vent_id: "vent-a" },
            { flair_vent_id: "vent-b" },
          ],
        },
      }),
      tickRecord: {
        zone_id: "z1",
        name: "Den Front",
        vent_hardware_type: "flair_smart_vent",
        classification: "demanding",
        occupied: false,
        spiking: false,
        temp_calibrated: null,
        resolved_setpoint: null,
        desired_position_pct: 100,
        post_contention_position_pct: 100,
        reason: "",
        vents: [
          {
            flair_vent_id: "vent-a",
            name: "",
            commanded_position_pct: 100,
            reported_position_pct: 100,
            dispatch_decision: "dispatched",
            step_delta_pct: null,
            min_step_delta_pct: null,
            degraded: false,
            voltage: null,
            current_rssi: null,
          },
          {
            flair_vent_id: "vent-b",
            name: "",
            commanded_position_pct: 100,
            reported_position_pct: 100,
            dispatch_decision: "dispatched",
            step_delta_pct: null,
            min_step_delta_pct: null,
            degraded: false,
            voltage: null,
            current_rssi: null,
          },
        ],
      },
    });
    expect(screen.getByText("Vent position (Vent 1)")).toBeInTheDocument();
    expect(screen.getByText("Vent position (Vent 2)")).toBeInTheDocument();
    expect(screen.queryByText(/vent-a/)).not.toBeInTheDocument();
    expect(screen.queryByText(/vent-b/)).not.toBeInTheDocument();
  });

  // Confirmed live against the real Flair account: a vent's own
  // JSON:API `attributes.name` is the user-set nickname from Flair's app
  // (e.g. "Den Front") — shown in preference to the ordinal fallback
  // whenever it's actually present.
  it("shows the vent's real Flair nickname when present, not an ordinal", () => {
    renderCard({
      zone: makeZone({
        config: {
          ...makeZone().config,
          flair_vents: [
            { flair_vent_id: "vent-a" },
            { flair_vent_id: "vent-b" },
          ],
        },
      }),
      tickRecord: {
        zone_id: "z1",
        name: "Den Front",
        vent_hardware_type: "flair_smart_vent",
        classification: "demanding",
        occupied: false,
        spiking: false,
        temp_calibrated: null,
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
            step_delta_pct: null,
            min_step_delta_pct: null,
            degraded: false,
            voltage: null,
            current_rssi: null,
          },
          {
            flair_vent_id: "vent-b",
            name: "Den Center North",
            commanded_position_pct: 100,
            reported_position_pct: 100,
            dispatch_decision: "dispatched",
            step_delta_pct: null,
            min_step_delta_pct: null,
            degraded: false,
            voltage: null,
            current_rssi: null,
          },
        ],
      },
    });
    expect(
      screen.getByText("Vent position (Den Center South)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Vent position (Den Center North)"),
    ).toBeInTheDocument();
  });

  // Regression test: "commanded" is this tick's target, not necessarily
  // what was actually sent to the vent — see the conversation this was
  // built from. The card must make that distinction visible rather than
  // implying every "commanded" value already reached the hardware.
  it("shows the accumulated delta toward dispatch when a command is being held, not sent as 'commanded'", () => {
    renderCard({
      tickRecord: {
        zone_id: "z1",
        name: "Den Front",
        vent_hardware_type: "flair_smart_vent",
        classification: "demanding",
        occupied: false,
        spiking: false,
        temp_calibrated: null,
        resolved_setpoint: null,
        desired_position_pct: 42,
        post_contention_position_pct: 42,
        reason: "",
        vents: [
          {
            flair_vent_id: "vent-1",
            name: "",
            commanded_position_pct: 42,
            reported_position_pct: 30,
            dispatch_decision: "suppressed_step_delta",
            step_delta_pct: 12,
            min_step_delta_pct: 30,
            degraded: false,
            voltage: null,
            current_rssi: null,
          },
        ],
      },
    });
    expect(
      screen.getByText("42% target · 30% reported · holding (Δ12%/30%)"),
    ).toBeInTheDocument();
  });

  it("shows 'sent' once a command actually goes out", () => {
    renderCard({
      tickRecord: {
        zone_id: "z1",
        name: "Den Front",
        vent_hardware_type: "flair_smart_vent",
        classification: "demanding",
        occupied: false,
        spiking: false,
        temp_calibrated: null,
        resolved_setpoint: null,
        desired_position_pct: 60,
        post_contention_position_pct: 60,
        reason: "",
        vents: [
          {
            flair_vent_id: "vent-1",
            name: "",
            commanded_position_pct: 60,
            reported_position_pct: 30,
            dispatch_decision: "dispatched",
            step_delta_pct: 30,
            min_step_delta_pct: 30,
            degraded: false,
            voltage: null,
            current_rssi: null,
          },
        ],
      },
    });
    expect(
      screen.getByText("60% target · 30% reported · sent"),
    ).toBeInTheDocument();
  });

  // Regression test: a satisfied, unoccupied zone resting at its own 0%
  // floor has nothing pending — showing "holding (Δ0% of 15% to move)"
  // falsely implies a real correction is being deliberately delayed.
  // Caught live via a screenshot of exactly this state.
  it("shows 'no change needed' rather than 'holding' for a vent already sitting at its own target", () => {
    renderCard({
      tickRecord: {
        zone_id: "z1",
        name: "Martin Bedroom",
        vent_hardware_type: "flair_smart_vent",
        classification: "satisfied",
        occupied: false,
        spiking: false,
        temp_calibrated: null,
        resolved_setpoint: null,
        desired_position_pct: 0,
        post_contention_position_pct: 0,
        reason: "",
        vents: [
          {
            flair_vent_id: "vent-1",
            name: "",
            commanded_position_pct: 0,
            reported_position_pct: 0,
            dispatch_decision: "suppressed_step_delta",
            step_delta_pct: 0,
            min_step_delta_pct: 15,
            degraded: false,
            voltage: null,
            current_rssi: null,
          },
        ],
      },
    });
    expect(
      screen.getByText("0% target · 0% reported · no change needed"),
    ).toBeInTheDocument();
  });
});
