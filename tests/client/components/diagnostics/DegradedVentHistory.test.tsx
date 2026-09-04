/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { Zone } from "~/client/api/zonesApi";
import type { AirHandlerTickDecision } from "~/client/api/airHandlersApi";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";
import DegradedVentHistory from "~/client/components/diagnostics/DegradedVentHistory";

afterEach(cleanup);

const theme = createTheme();
const NOW = new Date("2026-09-02T12:00:00.000Z").getTime();

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

function renderPanel(
  zones: Zone[],
  tickDecisionsByAirHandlerId: Map<
    string,
    AirHandlerTickDecision | null
  > = new Map(),
) {
  return render(
    <ThemeProvider theme={theme}>
      <DegradedVentHistory
        zones={zones}
        tickDecisionsByAirHandlerId={tickDecisionsByAirHandlerId}
        nowMs={NOW}
      />
    </ThemeProvider>,
  );
}

describe("DegradedVentHistory", () => {
  it("shows the empty state when no vent is currently degraded", () => {
    renderPanel([makeZone()]);
    expect(
      screen.getByText("No vents are currently degraded."),
    ).toBeInTheDocument();
  });

  it("lists a degraded vent with its zone, an ordinal fallback label, and how long it's been degraded", () => {
    renderPanel([
      makeZone({
        state: {
          ...makeZone().state,
          vents: [
            {
              flair_vent_id: "vent-1",
              last_reported_position: 40,
              degraded: true,
              degraded_since: "2026-09-02T11:30:00.000Z",
              reconcile_attempts: 3,
            },
          ],
        },
      }),
    ]);
    expect(screen.getByText("Martin Bedroom — Vent 1")).toBeInTheDocument();
    expect(screen.getByText("30m ago")).toBeInTheDocument();
  });

  it("prefers the vent's real Flair nickname over the ordinal fallback when a tick decision knows one", () => {
    const decisions = new Map([
      [
        "ah-1",
        {
          air_handler_id: "ah-1",
          tick_at: "2026-09-02T12:00:00.000Z",
          duration_ms: 1,
          dry_run: false,
          control_disarmed: false,
          equipment_fault_active: false,
          hvac_state: "IDLE",
          call_confidence: "reported" as const,
          zones: [
            {
              zone_id: "z1",
              name: "Martin Bedroom",
              vent_hardware_type: "flair_smart_vent",
              classification: "satisfied",
              occupied: false,
              spiking: false,
              temp_calibrated: null,
              resolved_setpoint: 21,
              desired_position_pct: 40,
              post_contention_position_pct: 40,
              vents: [
                {
                  flair_vent_id: "vent-1",
                  name: "Den Front",
                  commanded_position_pct: 40,
                  reported_position_pct: 40,
                  dispatch_decision: "dispatched",
                  degraded: true,
                  voltage: null,
                  current_rssi: null,
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
        },
      ],
    ]);
    renderPanel(
      [
        makeZone({
          state: {
            ...makeZone().state,
            vents: [
              {
                flair_vent_id: "vent-1",
                last_reported_position: 40,
                degraded: true,
                degraded_since: "2026-09-02T11:30:00.000Z",
                reconcile_attempts: 3,
              },
            ],
          },
        }),
      ],
      decisions,
    );
    expect(screen.getByText("Martin Bedroom — Den Front")).toBeInTheDocument();
  });

  it("only lists vents that are actually degraded, not every vent on the zone", () => {
    renderPanel([
      makeZone({
        state: {
          ...makeZone().state,
          vents: [
            {
              flair_vent_id: "vent-1",
              last_reported_position: 40,
              degraded: false,
              degraded_since: null,
              reconcile_attempts: 0,
            },
          ],
        },
      }),
    ]);
    expect(
      screen.getByText("No vents are currently degraded."),
    ).toBeInTheDocument();
  });

  function makeHistoryPoint(
    loggedAtMs: number,
    degraded: boolean,
  ): TickHistoryPoint {
    return {
      loggedAtMs,
      decision: {
        air_handler_id: "ah-1",
        tick_at: new Date(loggedAtMs).toISOString(),
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
            classification: "demanding",
            occupied: false,
            spiking: false,
            temp_calibrated: null,
            resolved_setpoint: null,
            desired_position_pct: null,
            post_contention_position_pct: null,
            vents: [
              {
                flair_vent_id: "vent-1",
                name: "",
                commanded_position_pct: null,
                reported_position_pct: null,
                dispatch_decision: "dispatched",
                degraded,
                voltage: null,
                current_rssi: null,
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
      },
    };
  }

  it("shows a historical degraded period when historyPoints is supplied", () => {
    render(
      <ThemeProvider theme={theme}>
        <DegradedVentHistory
          zones={[makeZone()]}
          tickDecisionsByAirHandlerId={new Map()}
          nowMs={NOW}
          historyPoints={[
            makeHistoryPoint(0, false),
            makeHistoryPoint(60_000, true),
            makeHistoryPoint(120_000, false),
          ]}
        />
      </ThemeProvider>,
    );
    expect(
      screen.getByText("Degraded Periods (this window)"),
    ).toBeInTheDocument();
    expect(screen.getByText("1m")).toBeInTheDocument();
  });

  it("hides the current-status section when hideCurrentStatus is set", () => {
    render(
      <ThemeProvider theme={theme}>
        <DegradedVentHistory
          zones={[makeZone()]}
          tickDecisionsByAirHandlerId={new Map()}
          nowMs={NOW}
          historyPoints={[makeHistoryPoint(0, false)]}
          hideCurrentStatus
        />
      </ThemeProvider>,
    );
    expect(
      screen.queryByText("Currently Degraded Vents"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Degraded Periods (this window)"),
    ).toBeInTheDocument();
  });
});
