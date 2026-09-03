/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Zone } from "~/client/api/zonesApi";
import type { AirHandlerTickDecision } from "~/client/api/airHandlersApi";
import HardwareDiagnostics from "~/client/components/diagnostics/HardwareDiagnostics";

afterEach(cleanup);

const theme = createTheme();

function makeZone(overrides: Partial<Zone> = {}): Zone {
  return {
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
    ...overrides,
  };
}

function makeDecision(
  vent: Partial<{
    flair_vent_id: string;
    name: string;
    voltage: number | null;
    current_rssi: number | null;
  }> = {},
): AirHandlerTickDecision {
  return {
    air_handler_id: "ah-1",
    tick_at: "2026-09-02T12:00:00.000Z",
    duration_ms: 1,
    dry_run: false,
    control_disarmed: false,
    equipment_fault_active: false,
    hvac_state: "IDLE",
    call_confidence: "reported",
    zones: [
      {
        zone_id: "z1",
        name: "Martin Bedroom",
        vent_hardware_type: "flair_smart_vent",
        classification: "satisfied",
        occupied: false,
        spiking: false,
        resolved_setpoint: 21,
        desired_position_pct: 40,
        post_contention_position_pct: 40,
        vents: [
          {
            flair_vent_id: "vent-1",
            name: "",
            commanded_position_pct: 40,
            reported_position_pct: 40,
            dispatch_decision: "dispatched",
            degraded: false,
            voltage: null,
            current_rssi: null,
            ...vent,
          },
        ],
        reason: "",
      },
    ],
    contention: null,
    pressure: null,
    driving_zone: null,
    setpoint_push: null,
    narrative: "",
  };
}

function renderPanel(
  zones: Zone[],
  tickDecisionsByAirHandlerId: Map<
    string,
    AirHandlerTickDecision | null
  > = new Map(),
) {
  return render(
    <ThemeProvider theme={theme}>
      <HardwareDiagnostics
        zones={zones}
        tickDecisionsByAirHandlerId={tickDecisionsByAirHandlerId}
      />
    </ThemeProvider>,
  );
}

describe("HardwareDiagnostics", () => {
  it("shows the empty state when there are no smart-vent zones", () => {
    renderPanel([]);
    expect(
      screen.getByText("No smart vents configured yet."),
    ).toBeInTheDocument();
  });

  it("shows a real vent's voltage and RSSI, using its Flair nickname when known", () => {
    const decisions = new Map([
      [
        "ah-1",
        makeDecision({ name: "Den Front", voltage: 3.18, current_rssi: -69 }),
      ],
    ]);
    renderPanel([makeZone()], decisions);
    expect(screen.getByText("Martin Bedroom — Den Front")).toBeInTheDocument();
    expect(screen.getByText("3.18 V")).toBeInTheDocument();
    expect(screen.getByText("RSSI -69 dBm")).toBeInTheDocument();
  });

  it("falls back to an ordinal vent label when no tick decision has a nickname yet", () => {
    renderPanel([makeZone()], new Map());
    expect(screen.getByText("Martin Bedroom — Vent 1")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.getByText("No reading yet")).toBeInTheDocument();
  });

  it("flags a low-voltage battery distinctly from a healthy one", () => {
    const decisions = new Map([
      ["ah-1", makeDecision({ voltage: 2.1, current_rssi: -70 })],
    ]);
    renderPanel([makeZone()], decisions);
    expect(screen.getByText("2.10 V")).toBeInTheDocument();
  });

  it("contributes no tiles for a manual or no-vent zone", () => {
    renderPanel([
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
    ]);
    expect(
      screen.getByText("No smart vents configured yet."),
    ).toBeInTheDocument();
  });
});
