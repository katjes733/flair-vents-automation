/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DisplayUnitProvider } from "~/client/theme/DisplayUnitProvider";
import { NotificationProvider } from "~/client/components/notification/NotificationContext";
import { systemSettingsConfigSchema } from "~/shared/schemas/systemSettings";

afterEach(cleanup);

// This page renders ~50 MUI TextFields across 15 Cards — by far the
// largest single form in the app — which comfortably clears the default
// 5000ms test timeout on its own but not under v8 coverage instrumentation
// (bun run test:coverage). Bumped file-wide rather than per-test.
vi.setConfig({ testTimeout: 15000 });

const { fetchSettings, updateSettings } = vi.hoisted(() => ({
  fetchSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
vi.mock("~/client/api/settingsApi", () => ({ fetchSettings, updateSettings }));

const { default: SystemParametersPage } =
  await import("~/client/components/settings/SystemParametersPage");

// The real, schema-resolved defaults — not a hand-typed fixture, so this
// test suite exercises the exact same values the page itself resolves its
// own defaults from (see systemParameterFields.ts's own SYSTEM_SETTINGS_DEFAULTS).
const DEFAULT_CONFIG = systemSettingsConfigSchema.parse({});

function renderPage() {
  return render(
    <DisplayUnitProvider>
      <NotificationProvider>
        <SystemParametersPage />
      </NotificationProvider>
    </DisplayUnitProvider>,
  );
}

describe("SystemParametersPage", () => {
  beforeEach(() => {
    localStorage.setItem("displayTemperatureUnit", "F");
    localStorage.setItem("displayAirflowUnit", "Lps");
    fetchSettings.mockReset().mockResolvedValue(DEFAULT_CONFIG);
    updateSettings.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows only common fields by default, at their real defaults, with advanced fields/groups hidden", async () => {
    renderPage();
    await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
    // "Position & ramp" has both common and advanced fields — the group
    // itself still renders, just with fewer rows than the full field list.
    expect(await screen.findByText("Position & ramp")).toBeInTheDocument();
    expect(screen.getByLabelText("Staleness threshold (min)")).toHaveValue(15);
    expect(
      screen.getByRole("button", {
        name: "Reset Staleness threshold (min) to default",
      }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    // Advanced-only field and advanced-only group are both absent.
    expect(
      screen.queryByLabelText("Tick interval (s)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Dynamic thermal spike detection"),
    ).not.toBeInTheDocument();
  });

  it("Show advanced parameters reveals advanced-only fields and groups, and persists the choice", async () => {
    renderPage();
    await screen.findByLabelText("Staleness threshold (min)");
    expect(
      screen.getByText("Show advanced parameters (41 hidden)"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));

    expect(await screen.findByLabelText("Tick interval (s)")).toHaveValue(60);
    expect(
      screen.getByText("Dynamic thermal spike detection"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Show advanced parameters (41 shown)"),
    ).toBeInTheDocument();
    expect(localStorage.getItem("systemParametersShowAdvanced")).toBe("true");
  });

  it("respects a previously-stored Show advanced preference on load", async () => {
    localStorage.setItem("systemParametersShowAdvanced", "true");
    renderPage();
    expect(await screen.findByLabelText("Tick interval (s)")).toHaveValue(60);
  });

  it("shows a fetched non-default value converted into the active display unit", async () => {
    fetchSettings.mockResolvedValue({
      ...DEFAULT_CONFIG,
      away_setpoint_cool: 21.11, // ~70°F, not the ~82°F schema default
    });
    renderPage();
    expect(
      await screen.findByLabelText("Away cooling setpoint (°F)"),
    ).toHaveValue(70);
    expect(
      screen.getByRole("button", {
        name: "Reset Away cooling setpoint (°F) to default",
      }),
    ).not.toBeDisabled();
  });

  it("editing a field enables Save and its own reset button; Reset clears both", async () => {
    renderPage();
    const field = await screen.findByLabelText("Staleness threshold (min)");
    fireEvent.change(field, { target: { value: "20" } });
    expect(screen.getByRole("button", { name: "Save (1)" })).not.toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Reset Staleness threshold (min) to default",
      }),
    ).not.toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Reset Staleness threshold (min) to default",
      }),
    );
    expect(field).toHaveValue(15);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("Save sends only the changed scalar field as a minimal patch", async () => {
    updateSettings.mockResolvedValue({
      config: { ...DEFAULT_CONFIG, stale_threshold_minutes: 20 },
      warnings: [],
    });
    renderPage();
    const field = await screen.findByLabelText("Staleness threshold (min)");
    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        stale_threshold_minutes: 20,
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled(),
    );
  });

  it("a changed modifier_boosts sub-field (an advanced field) sends the whole nested object, not a deep-partial", async () => {
    localStorage.setItem("systemParametersShowAdvanced", "true");
    updateSettings.mockResolvedValue({ config: DEFAULT_CONFIG, warnings: [] });
    renderPage();
    const field = await screen.findByLabelText("Occupancy boost");
    fireEvent.change(field, { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        modifier_boosts: {
          occupancy: 0.5,
          spike: DEFAULT_CONFIG.modifier_boosts.spike,
          high_internal_heat_load:
            DEFAULT_CONFIG.modifier_boosts.high_internal_heat_load,
          distant_high_duct_loss:
            DEFAULT_CONFIG.modifier_boosts.distant_high_duct_loss,
        },
      }),
    );
  });

  it("an advanced field edited while shown stays dirty and gets saved even after the toggle is switched back off", async () => {
    // The tier toggle only gates rendering, never the underlying draft —
    // hiding an already-edited advanced field must not silently drop it.
    localStorage.setItem("systemParametersShowAdvanced", "true");
    updateSettings.mockResolvedValue({
      config: { ...DEFAULT_CONFIG, reconciliation_retry_count: 5 },
      warnings: [],
    });
    renderPage();
    const field = await screen.findByLabelText("Reconciliation retry count");
    fireEvent.change(field, { target: { value: "5" } });

    fireEvent.click(screen.getByRole("switch")); // hide advanced fields again
    expect(
      screen.queryByLabelText("Reconciliation retry count"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save (1)" })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        reconciliation_retry_count: 5,
      }),
    );
  });

  it("shows the server's own warnings after a save", async () => {
    updateSettings.mockResolvedValue({
      config: DEFAULT_CONFIG,
      warnings: ["min_step_delta_pct exceeds the ramp's own step size."],
    });
    renderPage();
    const field = await screen.findByLabelText("Staleness threshold (min)");
    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    expect(
      await screen.findByText(
        "min_step_delta_pct exceeds the ramp's own step size.",
      ),
    ).toBeInTheDocument();
  });

  it("Discard changes reverts unsaved edits without calling the server", async () => {
    renderPage();
    const field = await screen.findByLabelText("Staleness threshold (min)");
    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(field).toHaveValue(15);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("Reset all to defaults is disabled when every field is already at its default", async () => {
    renderPage();
    await screen.findByLabelText("Staleness threshold (min)");
    expect(
      screen.getByRole("button", { name: "Reset all to defaults" }),
    ).toBeDisabled();
  });

  it("Reset all to defaults enables once any field is away from default, even unedited", async () => {
    fetchSettings.mockResolvedValue({
      ...DEFAULT_CONFIG,
      away_setpoint_cool: 21.11, // fetched non-default, never touched by the user
    });
    renderPage();
    await screen.findByLabelText("Staleness threshold (min)");
    expect(
      screen.getByRole("button", { name: "Reset all to defaults" }),
    ).not.toBeDisabled();
  });

  it("Reset all to defaults asks for confirmation; Cancel leaves every field untouched", async () => {
    renderPage();
    const field = await screen.findByLabelText("Staleness threshold (min)");
    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Reset all to defaults" }),
    );
    expect(
      await screen.findByText("Reset all parameters to their defaults?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(field).toHaveValue(20);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("confirming Reset all reverts every field to its default, locally, without calling the server", async () => {
    fetchSettings.mockResolvedValue({
      ...DEFAULT_CONFIG,
      stale_threshold_minutes: 20,
      away_setpoint_cool: 21.11,
    });
    renderPage();
    const staleField = await screen.findByLabelText(
      "Staleness threshold (min)",
    );
    expect(staleField).toHaveValue(20);
    const awayField = screen.getByLabelText("Away cooling setpoint (°F)");
    expect(awayField).toHaveValue(70);

    fireEvent.click(
      screen.getByRole("button", { name: "Reset all to defaults" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Reset all" }));
    // The dialog's own exit transition keeps the background aria-hidden
    // for a tick after the click — wait for it to actually close before
    // querying anything behind it.
    await waitFor(() =>
      expect(
        screen.queryByText("Reset all parameters to their defaults?"),
      ).not.toBeInTheDocument(),
    );

    expect(staleField).toHaveValue(15);
    expect(awayField).toHaveValue(82);
    expect(updateSettings).not.toHaveBeenCalled();
    // Reverted locally to defaults, which differ from what's actually saved
    // — Save is still available to persist the reset, not auto-disabled.
    expect(screen.getByRole("button", { name: "Save (2)" })).not.toBeDisabled();
  });

  it("changing the enum field (zone ranking mode) marks it dirty", async () => {
    renderPage();
    await screen.findByText("Contention resolution");
    await userEvent.click(
      screen.getByRole("combobox", { name: "Zone ranking mode" }),
    );
    await userEvent.click(
      await screen.findByRole("option", {
        name: "Priority order only (no bucketing)",
      }),
    );
    expect(screen.getByRole("button", { name: "Save (1)" })).not.toBeDisabled();
  });

  it("shows the server's error message on a failed save", async () => {
    updateSettings.mockRejectedValue(new Error("boom"));
    renderPage();
    const field = await screen.findByLabelText("Staleness threshold (min)");
    fireEvent.change(field, { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Save (1)" }));
    expect(
      await screen.findByText("Couldn't save system parameters."),
    ).toBeInTheDocument();
  });
});
