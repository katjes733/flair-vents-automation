/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import AgreementMetric from "~/client/components/telemetry/AgreementMetric";
import type { TickHistoryPoint } from "~/client/api/telemetryApi";

afterEach(cleanup);

function makePoint(
  commanded: number | null,
  reported: number | null,
): TickHistoryPoint {
  return {
    loggedAtMs: 100,
    decision: {
      air_handler_id: "ah-1",
      tick_at: "x",
      duration_ms: 1,
      dry_run: false,
      control_disarmed: false,
      equipment_fault_active: false,
      hvac_state: "IDLE",
      call_confidence: "reported",
      zones: [
        {
          zone_id: "z1",
          name: "Z",
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
              flair_vent_id: "v1",
              name: "",
              commanded_position_pct: commanded,
              reported_position_pct: reported,
              dispatch_decision: "dispatched",
              degraded: false,
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

describe("AgreementMetric", () => {
  it("shows the mean absolute delta and sample count", () => {
    render(<AgreementMetric points={[makePoint(50, 40)]} />);
    expect(screen.getByText("10.0%")).toBeInTheDocument();
    expect(screen.getByText("1 vent-ticks in this window")).toBeInTheDocument();
  });

  it("shows a placeholder when there are no comparable samples", () => {
    render(<AgreementMetric points={[makePoint(50, null)]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(
      screen.getByText("No vent samples in this window yet"),
    ).toBeInTheDocument();
  });
});
