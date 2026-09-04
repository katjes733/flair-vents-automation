/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import TickDecisionInspector from "~/client/components/dashboard/TickDecisionInspector";
import type { AirHandlerTickDecision } from "~/client/api/airHandlersApi";

afterEach(cleanup);

const theme = createTheme();

function renderInspector(decision: AirHandlerTickDecision | null) {
  return render(
    <ThemeProvider theme={theme}>
      <TickDecisionInspector decision={decision} />
    </ThemeProvider>,
  );
}

describe("TickDecisionInspector", () => {
  it("renders nothing when there is no decision yet", () => {
    const { container } = renderInspector(null);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders the narrative and per-zone table for a real decision", async () => {
    const user = userEvent.setup();
    renderInspector({
      air_handler_id: "ah-1",
      tick_at: "2024-01-01T00:00:00.000Z",
      duration_ms: 12,
      dry_run: false,
      control_disarmed: false,
      equipment_fault_active: false,
      hvac_state: "COOLING_CALL",
      call_confidence: "reported",
      zones: [
        {
          zone_id: "z1",
          name: "Bedroom",
          vent_hardware_type: "flair_smart_vent",
          classification: "demanding",
          occupied: false,
          spiking: false,
          temp_calibrated: null,
          resolved_setpoint: null,
          desired_position_pct: 60,
          post_contention_position_pct: 60,
          vents: [
            {
              flair_vent_id: "vent-1",
              name: "Bedroom Vent",
              commanded_position_pct: 50,
              reported_position_pct: 48,
              dispatch_decision: "dispatched",
              step_delta_pct: null,
              min_step_delta_pct: null,
              degraded: false,
              voltage: null,
              current_rssi: null,
            },
          ],
          reason: "still cooling",
        },
      ],
      contention: null,
      pressure: {
        aggregate_open_lps: 100,
        aggregate_open_pct: 40,
        floor_lps: 50,
        cap_pct: 100,
        clamped: false,
        blower_rated_flow_rate_is_estimate: false,
        minimum_aggregate_flow_is_estimate: false,
      },
      driving_zone: { zone_id: "z1", reason: "dynamic_worst_off" },
      setpoint_push: {
        pushed_value: 20.5,
        pushed_value_c: 20.5,
        thermostat_reading: 22,
        thermostat_current_setpoint: 21,
        would_write: true,
        demanding_zone_count: 1,
      },
      narrative: "COOLING_CALL, tracking Bedroom.",
    });

    await user.click(
      screen.getByRole("button", { name: "Tick decision inspector" }),
    );

    expect(
      screen.getByText("COOLING_CALL, tracking Bedroom."),
    ).toBeInTheDocument();
    expect(screen.getByText("Bedroom")).toBeInTheDocument();
    expect(screen.getByText("demanding")).toBeInTheDocument();
    expect(screen.getByText("sent")).toBeInTheDocument();
  });

  // Regression test: the Dispatch column previously showed the raw
  // dispatch_decision enum ("suppressed_step_delta") with no indication of
  // how close the vent actually is to moving — see the conversation this
  // was built from ("is the commanded truly the command being sent?").
  it("shows the accumulated delta against the threshold when a dispatch is held, not the raw enum", async () => {
    const user = userEvent.setup();
    renderInspector({
      air_handler_id: "ah-1",
      tick_at: "2024-01-01T00:00:00.000Z",
      duration_ms: 12,
      dry_run: false,
      control_disarmed: false,
      equipment_fault_active: false,
      hvac_state: "COOLING_CALL",
      call_confidence: "reported",
      zones: [
        {
          zone_id: "z1",
          name: "Bedroom",
          vent_hardware_type: "flair_smart_vent",
          classification: "demanding",
          occupied: false,
          spiking: false,
          temp_calibrated: null,
          resolved_setpoint: null,
          desired_position_pct: 60,
          post_contention_position_pct: 60,
          vents: [
            {
              flair_vent_id: "vent-1",
              name: "Bedroom Vent",
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
          reason: "still cooling",
        },
      ],
      contention: null,
      pressure: null,
      driving_zone: null,
      setpoint_push: null,
      narrative: "COOLING_CALL, tracking Bedroom.",
    });

    await user.click(
      screen.getByRole("button", { name: "Tick decision inspector" }),
    );

    expect(screen.getByText("holding (Δ12%/30%)")).toBeInTheDocument();
    expect(screen.queryByText("suppressed_step_delta")).not.toBeInTheDocument();
  });

  // Regression test: a multi-vent zone's rows previously showed the raw
  // Flair vent id in the "Vent" column instead of an ordinal — confirmed
  // live via a screenshot of a 3-vent zone.
  it("falls back to an ordinal in the Vent column when a vent has no name yet", async () => {
    const user = userEvent.setup();
    renderInspector({
      air_handler_id: "ah-1",
      tick_at: "2024-01-01T00:00:00.000Z",
      duration_ms: 12,
      dry_run: false,
      control_disarmed: false,
      equipment_fault_active: false,
      hvac_state: "COOLING_CALL",
      call_confidence: "reported",
      zones: [
        {
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
          reason: "",
        },
      ],
      contention: null,
      pressure: {
        aggregate_open_lps: 100,
        aggregate_open_pct: 40,
        floor_lps: 50,
        cap_pct: 100,
        clamped: false,
        blower_rated_flow_rate_is_estimate: false,
        minimum_aggregate_flow_is_estimate: false,
      },
      driving_zone: null,
      setpoint_push: null,
      narrative: "COOLING_CALL.",
    });

    await user.click(
      screen.getByRole("button", { name: "Tick decision inspector" }),
    );

    expect(screen.getByText("Vent 1")).toBeInTheDocument();
    expect(screen.getByText("Vent 2")).toBeInTheDocument();
    expect(screen.queryByText(/vent-a/)).not.toBeInTheDocument();
    expect(screen.queryByText(/vent-b/)).not.toBeInTheDocument();
  });

  // Confirmed live against the real Flair account: a vent's own
  // JSON:API `attributes.name` is the user-set nickname from Flair's app.
  it("shows the vent's real Flair nickname in the Vent column when present", async () => {
    const user = userEvent.setup();
    renderInspector({
      air_handler_id: "ah-1",
      tick_at: "2024-01-01T00:00:00.000Z",
      duration_ms: 12,
      dry_run: false,
      control_disarmed: false,
      equipment_fault_active: false,
      hvac_state: "COOLING_CALL",
      call_confidence: "reported",
      zones: [
        {
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
          reason: "",
        },
      ],
      contention: null,
      pressure: {
        aggregate_open_lps: 100,
        aggregate_open_pct: 40,
        floor_lps: 50,
        cap_pct: 100,
        clamped: false,
        blower_rated_flow_rate_is_estimate: false,
        minimum_aggregate_flow_is_estimate: false,
      },
      driving_zone: null,
      setpoint_push: null,
      narrative: "COOLING_CALL.",
    });

    await user.click(
      screen.getByRole("button", { name: "Tick decision inspector" }),
    );

    expect(screen.getByText("Den Center South")).toBeInTheDocument();
  });
});
