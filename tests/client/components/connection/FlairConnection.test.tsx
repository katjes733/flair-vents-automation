/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import type { FlairStatus } from "~/client/api/controlApi";
import FlairConnection from "~/client/components/connection/FlairConnection";

afterEach(cleanup);

const theme = createTheme();
const NOW = new Date("2026-09-02T12:00:00.000Z").getTime();

function makeStatus(overrides: Partial<FlairStatus> = {}): FlairStatus {
  return {
    outage: { failing: false, sinceMs: null },
    tokenRefreshFailure: null,
    tokenCallsToday: 3,
    tokenDailyBudget: 50,
    ...overrides,
  };
}

function renderConnection(status: FlairStatus | null) {
  return render(
    <ThemeProvider theme={theme}>
      <FlairConnection flairStatus={status} nowMs={NOW} />
    </ThemeProvider>,
  );
}

describe("FlairConnection", () => {
  it("shows a healthy connection and today's token usage", () => {
    renderConnection(makeStatus());
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("3 / 50")).toBeInTheDocument();
    expect(screen.getByText("6% of daily budget")).toBeInTheDocument();
  });

  it("shows an active outage with its elapsed duration", () => {
    renderConnection(
      makeStatus({
        outage: { failing: true, sinceMs: NOW - 5 * 60_000 },
      }),
    );
    expect(screen.getByText("Outage")).toBeInTheDocument();
    expect(screen.getByText("since 5m ago")).toBeInTheDocument();
  });

  it("distinguishes a terminal token-refresh failure from a transient one", () => {
    renderConnection(
      makeStatus({
        tokenRefreshFailure: { terminal: true, message: "invalid_grant" },
      }),
    );
    expect(screen.getByText("Needs re-auth")).toBeInTheDocument();
    expect(screen.getByText("invalid_grant")).toBeInTheDocument();

    cleanup();
    renderConnection(
      makeStatus({
        tokenRefreshFailure: { terminal: false, message: "network error" },
      }),
    );
    expect(screen.getByText("Transient failure")).toBeInTheDocument();
  });

  it("flags the token budget as a warning once usage crosses 70%", () => {
    renderConnection(makeStatus({ tokenCallsToday: 40, tokenDailyBudget: 50 }));
    expect(screen.getByText("80% of daily budget")).toBeInTheDocument();
  });

  it("shows an unavailable message with no status yet, but still renders the static capability matrix", () => {
    renderConnection(null);
    expect(
      screen.getByText("Connection status unavailable."),
    ).toBeInTheDocument();
    expect(screen.getByText("Grant mode")).toBeInTheDocument();
    expect(
      screen.getByText("Battery voltage / RSSI on vents"),
    ).toBeInTheDocument();
  });
});
