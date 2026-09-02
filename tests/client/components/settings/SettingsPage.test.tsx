/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { ThemeModeProvider } from "~/client/theme/ThemeModeProvider";
import { DiagnosticModeProvider } from "~/client/theme/DiagnosticModeProvider";
import { DisplayUnitProvider } from "~/client/theme/DisplayUnitProvider";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";

afterEach(cleanup);

const { fetchSettings } = vi.hoisted(() => ({ fetchSettings: vi.fn() }));
vi.mock("~/client/api/settingsApi", () => ({ fetchSettings }));

const { default: SettingsPage } =
  await import("~/client/components/settings/SettingsPage");

function renderPage() {
  return render(
    <ThemeModeProvider>
      <DiagnosticModeProvider>
        <DisplayUnitProvider>
          <NotificationProvider>
            <SettingsPage />
          </NotificationProvider>
        </DisplayUnitProvider>
      </DiagnosticModeProvider>
    </ThemeModeProvider>,
  );
}

describe("SettingsPage", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSettings.mockReset().mockResolvedValue({
      control_disarmed: false,
      live_air_handler_ids: [],
      display_temperature_unit: "F",
      display_airflow_unit: "Lps",
    });
  });

  it("reflects the system default once fetched, with no browser override yet", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "°F" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });
    expect(
      screen.queryByRole("button", { name: "Use system default" }),
    ).not.toBeInTheDocument();
  });

  it("switching temperature unit applies immediately and persists per-browser", async () => {
    renderPage();
    await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "°C" }));
    expect(screen.getByRole("button", { name: "°C" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(localStorage.getItem("displayTemperatureUnit")).toBe("C");
    expect(
      screen.getAllByRole("button", { name: "Use system default" }),
    ).toHaveLength(1);
  });

  it("'Use system default' clears the override and falls back to the fetched default", async () => {
    localStorage.setItem("displayTemperatureUnit", "C");
    renderPage();
    await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
    fireEvent.click(
      screen.getAllByRole("button", { name: "Use system default" })[0],
    );
    expect(localStorage.getItem("displayTemperatureUnit")).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "°F" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
  });

  it("switching airflow unit applies immediately and persists per-browser", async () => {
    renderPage();
    await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
    fireEvent.mouseDown(screen.getByRole("combobox"));
    fireEvent.click(await screen.findByRole("option", { name: "CFM" }));
    expect(localStorage.getItem("displayAirflowUnit")).toBe("CFM");
  });

  it("toggles dark mode immediately and persists it", () => {
    renderPage();
    const darkModeSwitch = screen.getByRole("switch", { name: "Dark mode" });
    expect(darkModeSwitch).not.toBeChecked();
    fireEvent.click(darkModeSwitch);
    expect(darkModeSwitch).toBeChecked();
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("toggles Diagnostic Mode immediately and persists it", () => {
    renderPage();
    const diagnosticSwitch = screen.getByRole("switch", {
      name: "Diagnostic Mode",
    });
    fireEvent.click(diagnosticSwitch);
    expect(diagnosticSwitch).toBeChecked();
    expect(localStorage.getItem("diagnosticMode")).toBe("true");
  });

  it("saves an edited display name", () => {
    renderPage();
    const nameField = screen.getByRole("textbox");
    fireEvent.change(nameField, { target: { value: "Martin" } });
    const saveButton = screen.getByRole("button", { name: "Save" });
    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);
    expect(localStorage.getItem("actorDisplayName")).toBe("Martin");
    expect(saveButton).toBeDisabled();
  });
});
