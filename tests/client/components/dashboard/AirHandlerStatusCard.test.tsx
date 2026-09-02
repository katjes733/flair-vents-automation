/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { AirHandler } from "~/client/api/airHandlersApi";
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

// Regression coverage for moving the "Edit"/"Sync with Flair" toolbar
// actions from a separate row above the card into the card's own header
// — closing the vertical gap the user flagged live. AirHandlerStatusCard
// had no test file at all before this; scoped to the new `children` slot
// this change actually introduced, not a full backfill.
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
});
