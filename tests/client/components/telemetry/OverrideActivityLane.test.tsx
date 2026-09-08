/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import OverrideActivityLane from "~/client/components/telemetry/OverrideActivityLane";
import { lightStatusPalette } from "~/client/theme/statusPalette";
import type { ManualOverrideRecord } from "~/client/api/overridesApi";

afterEach(cleanup);

const theme = createTheme({
  palette: { mode: "light", status: lightStatusPalette },
});

function renderLane(overrides: ManualOverrideRecord[]) {
  return render(
    <ThemeProvider theme={theme}>
      <OverrideActivityLane overrides={overrides} domain={[0, 1000]} />
    </ThemeProvider>,
  );
}

describe("OverrideActivityLane", () => {
  it("shows an empty-state message with no overrides", () => {
    renderLane([]);
    expect(
      screen.getByText("No overrides in this window."),
    ).toBeInTheDocument();
  });

  it("renders a segment labeled with the actor, kind, value, and hold type", () => {
    const { container } = renderLane([
      {
        id: "mo-1",
        zoneId: "z1",
        config: {
          kind: "position",
          value: 40,
          hold_type: "2h",
          actor: "Martin",
        },
        createdAtMs: 100,
        expiresAtMs: 500,
        revokedAtMs: null,
      },
    ]);
    expect(
      screen.queryByText("No overrides in this window."),
    ).not.toBeInTheDocument();
    const segment = container.querySelector("[data-testid='timeline-segment']");
    expect(segment).toHaveAttribute("data-label", "Martin: position 40% (2h)");
  });

  it("converts a setpoint override's value to the display unit and notes a revocation", () => {
    const { container } = renderLane([
      {
        id: "mo-1",
        zoneId: "z1",
        config: {
          kind: "setpoint",
          value: 22.222222222222,
          hold_type: "permanent",
          actor: "Sherri",
        },
        createdAtMs: 100,
        expiresAtMs: null,
        revokedAtMs: 400,
      },
    ]);
    const segment = container.querySelector("[data-testid='timeline-segment']");
    // No <DisplayUnitProvider> in this test — the context's own bare
    // default is Celsius (a deliberate no-op passthrough for isolated
    // component tests; see "Settings Page" in the implementation plan),
    // so this renders unconverted.
    expect(segment).toHaveAttribute(
      "data-label",
      "Sherri: setpoint 22.2°C (permanent, revoked)",
    );
  });

  it("explains what this section means via an info tooltip", () => {
    renderLane([]);
    expect(
      screen.getByRole("button", { name: "About Manual Override Activity" }),
    ).toBeInTheDocument();
  });
});
