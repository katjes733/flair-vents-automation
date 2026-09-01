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
          desired_position_pct: 60,
          post_contention_position_pct: 60,
          vents: [
            {
              flair_vent_id: "vent-1",
              commanded_position_pct: 50,
              reported_position_pct: 48,
              dispatch_decision: "dispatched",
              degraded: false,
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
    expect(screen.getByText("dispatched")).toBeInTheDocument();
  });
});
