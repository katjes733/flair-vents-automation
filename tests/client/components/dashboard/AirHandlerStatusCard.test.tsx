/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { DiagnosticModeContext } from "~/client/theme/diagnosticModeContextValue";
import type {
  AirHandler,
  AirHandlerTickDecision,
  ZoneTickDecisionRecord,
} from "~/client/api/airHandlersApi";
import AirHandlerStatusCard from "~/client/components/dashboard/AirHandlerStatusCard";

afterEach(cleanup);

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

function makeZone(
  overrides: Partial<ZoneTickDecisionRecord> = {},
): ZoneTickDecisionRecord {
  return {
    zone_id: "z1",
    name: "Martin Bedroom",
    vent_hardware_type: "flair_smart_vent",
    classification: "demanding",
    occupied: false,
    spiking: false,
    resolved_setpoint: 21.11,
    desired_position_pct: 60,
    post_contention_position_pct: 60,
    vents: [],
    reason: "demanding — cooling toward setpoint",
    ...overrides,
  };
}

function makeDecision(
  overrides: Partial<AirHandlerTickDecision> = {},
): AirHandlerTickDecision {
  return {
    air_handler_id: "ah-1",
    tick_at: "2026-09-02T12:00:00.000Z",
    duration_ms: 42,
    dry_run: false,
    control_disarmed: false,
    hvac_state: "COOLING_CALL",
    call_confidence: "reported",
    zones: [makeZone()],
    contention: null,
    pressure: null,
    driving_zone: null,
    setpoint_push: null,
    narrative: "COOLING_CALL, tracking Martin Bedroom (dynamic_worst_off).",
    ...overrides,
  };
}

function renderCard({
  decision = null as AirHandlerTickDecision | null,
  isLive = true,
  diagnosticMode = false,
}: {
  decision?: AirHandlerTickDecision | null;
  isLive?: boolean;
  diagnosticMode?: boolean;
} = {}) {
  return render(
    <ThemeProvider theme={theme}>
      <DiagnosticModeContext.Provider
        value={{ diagnosticMode, toggle: () => {} }}
      >
        <AirHandlerStatusCard
          airHandler={AIR_HANDLER}
          decision={decision}
          isLive={isLive}
        />
      </DiagnosticModeContext.Provider>
    </ThemeProvider>,
  );
}

describe("AirHandlerStatusCard", () => {
  it("renders toolbar actions passed as children alongside the status pills", () => {
    render(
      <ThemeProvider theme={theme}>
        <AirHandlerStatusCard airHandler={AIR_HANDLER} decision={null} isLive>
          <button>Edit</button>
          <button>Sync with Flair</button>
        </AirHandlerStatusCard>
      </ThemeProvider>,
    );
    expect(screen.getByText("Upstairs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sync with Flair" }),
    ).toBeInTheDocument();
  });

  it("renders without children just fine (no toolbar actions passed)", () => {
    render(
      <ThemeProvider theme={theme}>
        <AirHandlerStatusCard
          airHandler={AIR_HANDLER}
          decision={null}
          isLive={false}
        />
      </ThemeProvider>,
    );
    expect(screen.getByText("Upstairs")).toBeInTheDocument();
    expect(screen.getByText("Shadow Mode")).toBeInTheDocument();
  });

  it("shows the waiting message and no HVAC-state chip when there's no tick decision yet", () => {
    renderCard({ decision: null });
    expect(
      screen.getByText(
        "No tick decision yet — waiting for the control loop's first cycle.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Cooling")).not.toBeInTheDocument();
  });

  it("shows the Shadow Mode chip only when the air handler isn't live, regardless of decision state", () => {
    renderCard({ decision: makeDecision(), isLive: false });
    expect(screen.getByText("Shadow Mode")).toBeInTheDocument();

    cleanup();
    renderCard({ decision: makeDecision(), isLive: true });
    expect(screen.queryByText("Shadow Mode")).not.toBeInTheDocument();
  });

  it.each([
    ["COOLING_CALL", "Cooling"],
    ["HEATING_CALL", "Heating"],
    ["FAN_ONLY", "Fan only"],
    ["IDLE", "Idle"],
  ])("labels the %s HVAC state chip as %s", (hvacState, label) => {
    renderCard({ decision: makeDecision({ hvac_state: hvacState }) });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("falls back to the raw HVAC state string for an unrecognized value", () => {
    renderCard({ decision: makeDecision({ hvac_state: "SOMETHING_NEW" }) });
    expect(screen.getByText("SOMETHING_NEW")).toBeInTheDocument();
  });

  it("renders the tick's narrative", () => {
    renderCard({
      decision: makeDecision({ narrative: "IDLE — every zone satisfied." }),
    });
    expect(
      screen.getByText("IDLE — every zone satisfied."),
    ).toBeInTheDocument();
  });

  it("resolves the driving zone's name from the zone list and humanizes the selection reason", () => {
    renderCard({
      decision: makeDecision({
        zones: [makeZone({ zone_id: "z1", name: "Martin Office" })],
        driving_zone: { zone_id: "z1", reason: "dynamic_worst_off" },
      }),
    });
    expect(screen.getByText("Martin Office")).toBeInTheDocument();
    expect(screen.getByText(/dynamic worst off/)).toBeInTheDocument();
  });

  it("shows no driving-zone line when nothing is currently tracked", () => {
    renderCard({
      decision: makeDecision({
        driving_zone: { zone_id: null, reason: "no_eligible_zone" },
      }),
    });
    expect(screen.queryByText(/Tracking/)).not.toBeInTheDocument();
  });

  it("renders no Ecobee section at all when setpoint_push is null", () => {
    renderCard({ decision: makeDecision({ setpoint_push: null }) });
    expect(screen.queryByText("Ecobee (live)")).not.toBeInTheDocument();
  });

  it("renders the thermostat reading, held setpoint, and this app's pushed value", () => {
    renderCard({
      decision: makeDecision({
        setpoint_push: {
          pushed_value: 21.5,
          pushed_value_c: 21.5,
          thermostat_reading: 22,
          thermostat_current_setpoint: 21,
          would_write: true,
          demanding_zone_count: 1,
        },
      }),
    });
    expect(screen.getByText("Ecobee (live)")).toBeInTheDocument();
    expect(screen.getByText("22.0°C")).toBeInTheDocument();
    expect(screen.getByText(/holding 21\.0°C/)).toBeInTheDocument();
    expect(screen.getByText("21.5°C")).toBeInTheDocument();
    expect(screen.queryByText(/not written/)).not.toBeInTheDocument();
  });

  it('flags the pushed value as "(not written)" when would_write is false', () => {
    renderCard({
      decision: makeDecision({
        setpoint_push: {
          pushed_value: 21.5,
          pushed_value_c: 21.5,
          thermostat_reading: 22,
          thermostat_current_setpoint: null,
          would_write: false,
          demanding_zone_count: 1,
        },
      }),
    });
    expect(screen.getByText(/21\.5°C \(not written\)/)).toBeInTheDocument();
    expect(screen.queryByText(/holding/)).not.toBeInTheDocument();
  });

  it("shows an em dash for the thermostat reading when it's null", () => {
    renderCard({
      decision: makeDecision({
        setpoint_push: {
          pushed_value: null,
          pushed_value_c: null,
          thermostat_reading: null,
          thermostat_current_setpoint: null,
          would_write: false,
          demanding_zone_count: 0,
        },
      }),
    });
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.queryByText("This app's computed call"),
    ).not.toBeInTheDocument();
  });

  it("renders no open-capacity section when pressure is null", () => {
    renderCard({ decision: makeDecision({ pressure: null }) });
    expect(screen.queryByText("Open capacity")).not.toBeInTheDocument();
  });

  it("shows the open-capacity percentage and a warning color when floor-clamped", () => {
    renderCard({
      decision: makeDecision({
        pressure: {
          aggregate_open_lps: 400,
          aggregate_open_pct: 62,
          floor_lps: 708,
          cap_pct: 80,
          clamped: true,
          blower_rated_flow_rate_is_estimate: false,
          minimum_aggregate_flow_is_estimate: false,
        },
      }),
    });
    expect(screen.getByText("62% (floor-clamped)")).toBeInTheDocument();
  });

  it("shows the plain percentage with no clamp note when not clamped", () => {
    renderCard({
      decision: makeDecision({
        pressure: {
          aggregate_open_lps: 400,
          aggregate_open_pct: 34,
          floor_lps: 708,
          cap_pct: 80,
          clamped: false,
          blower_rated_flow_rate_is_estimate: false,
          minimum_aggregate_flow_is_estimate: false,
        },
      }),
    });
    expect(screen.getByText("34%")).toBeInTheDocument();
  });

  it("hides the floor/blower diagnostic caption unless Diagnostic Mode is on", () => {
    renderCard({
      diagnosticMode: false,
      decision: makeDecision({
        pressure: {
          aggregate_open_lps: 400,
          aggregate_open_pct: 34,
          floor_lps: 708,
          cap_pct: 80,
          clamped: false,
          blower_rated_flow_rate_is_estimate: true,
          minimum_aggregate_flow_is_estimate: true,
        },
      }),
    });
    expect(screen.queryByText(/Floor 708/)).not.toBeInTheDocument();
  });

  it("shows the confirmed/estimate floor and blower status under Diagnostic Mode", () => {
    renderCard({
      diagnosticMode: true,
      decision: makeDecision({
        pressure: {
          aggregate_open_lps: 400,
          aggregate_open_pct: 34,
          floor_lps: 708,
          cap_pct: 80,
          clamped: false,
          blower_rated_flow_rate_is_estimate: false,
          minimum_aggregate_flow_is_estimate: true,
        },
      }),
    });
    expect(
      screen.getByText("Floor 708 L/s (estimate) · Blower rating confirmed"),
    ).toBeInTheDocument();
  });
});
