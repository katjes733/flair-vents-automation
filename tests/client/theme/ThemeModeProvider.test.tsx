/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ThemeModeProvider } from "~/client/theme/ThemeModeProvider";
import { useThemeMode } from "~/client/theme/useThemeMode";

afterEach(cleanup);

function Probe() {
  const { mode, toggle } = useThemeMode();
  return (
    <button onClick={toggle} data-testid="probe">
      {mode}
    </button>
  );
}

describe("ThemeModeProvider", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to light when nothing is stored", () => {
    render(
      <ThemeModeProvider>
        <Probe />
      </ThemeModeProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("light");
  });

  it("reads a previously-stored mode", () => {
    localStorage.setItem("theme", "dark");
    render(
      <ThemeModeProvider>
        <Probe />
      </ThemeModeProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("dark");
  });

  it("toggles and persists the new mode", () => {
    render(
      <ThemeModeProvider>
        <Probe />
      </ThemeModeProvider>,
    );
    fireEvent.click(screen.getByTestId("probe"));
    expect(screen.getByTestId("probe")).toHaveTextContent("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });
});
