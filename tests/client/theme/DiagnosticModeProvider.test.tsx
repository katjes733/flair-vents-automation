/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { DiagnosticModeProvider } from "~/client/theme/DiagnosticModeProvider";
import { useDiagnosticMode } from "~/client/theme/useDiagnosticMode";
import { DiagnosticOnly } from "~/client/components/shared/DiagnosticOnly";

afterEach(cleanup);

function Probe() {
  const { diagnosticMode, toggle } = useDiagnosticMode();
  return (
    <div>
      <button onClick={toggle} data-testid="toggle">
        {diagnosticMode ? "on" : "off"}
      </button>
      <DiagnosticOnly>
        <div data-testid="secret">only visible in diagnostic mode</div>
      </DiagnosticOnly>
    </div>
  );
}

describe("DiagnosticModeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to off", () => {
    render(
      <DiagnosticModeProvider>
        <Probe />
      </DiagnosticModeProvider>,
    );
    expect(screen.getByTestId("toggle")).toHaveTextContent("off");
    expect(screen.queryByTestId("secret")).not.toBeInTheDocument();
  });

  it("toggles on, persists, and reveals DiagnosticOnly content", () => {
    render(
      <DiagnosticModeProvider>
        <Probe />
      </DiagnosticModeProvider>,
    );
    fireEvent.click(screen.getByTestId("toggle"));
    expect(screen.getByTestId("toggle")).toHaveTextContent("on");
    expect(screen.getByTestId("secret")).toBeInTheDocument();
    expect(localStorage.getItem("diagnosticMode")).toBe("true");
  });

  it("reads a previously-stored true value", () => {
    localStorage.setItem("diagnosticMode", "true");
    render(
      <DiagnosticModeProvider>
        <Probe />
      </DiagnosticModeProvider>,
    );
    expect(screen.getByTestId("toggle")).toHaveTextContent("on");
  });
});
