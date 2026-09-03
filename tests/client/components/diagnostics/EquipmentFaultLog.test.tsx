/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type {
  AirHandler,
  AirHandlerTickDecision,
} from "~/client/api/airHandlersApi";
import EquipmentFaultLog from "~/client/components/diagnostics/EquipmentFaultLog";

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

function makeDecision(
  overrides: Partial<AirHandlerTickDecision> = {},
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
    zones: [],
    contention: null,
    pressure: null,
    driving_zone: null,
    setpoint_push: null,
    narrative: "",
    ...overrides,
  };
}

function renderPanel(
  tickDecisionsByAirHandlerId: Map<string, AirHandlerTickDecision | null>,
) {
  return render(
    <ThemeProvider theme={theme}>
      <EquipmentFaultLog
        airHandlers={[AIR_HANDLER]}
        tickDecisionsByAirHandlerId={tickDecisionsByAirHandlerId}
      />
    </ThemeProvider>,
  );
}

describe("EquipmentFaultLog", () => {
  it("shows Normal for a healthy air handler", () => {
    renderPanel(
      new Map([["ah-1", makeDecision({ equipment_fault_active: false })]]),
    );
    expect(screen.getByText("Normal")).toBeInTheDocument();
  });

  it("shows Fault active when the emergency fail-safe is currently active", () => {
    renderPanel(
      new Map([["ah-1", makeDecision({ equipment_fault_active: true })]]),
    );
    expect(screen.getByText("Fault active")).toBeInTheDocument();
  });

  it("shows a waiting caption when no tick decision exists yet", () => {
    renderPanel(new Map([["ah-1", null]]));
    expect(screen.getByText("Normal")).toBeInTheDocument();
    expect(screen.getByText("No tick decision yet")).toBeInTheDocument();
  });

  it("renders one tile per air handler", () => {
    renderPanel(new Map());
    expect(screen.getByText("Upstairs")).toBeInTheDocument();
  });
});
