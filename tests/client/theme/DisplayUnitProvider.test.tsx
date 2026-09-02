/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { DisplayUnitProvider } from "~/client/theme/DisplayUnitProvider";
import { useDisplayUnit } from "~/client/theme/useDisplayUnit";

afterEach(cleanup);

const { fetchSettings } = vi.hoisted(() => ({ fetchSettings: vi.fn() }));
vi.mock("~/client/api/settingsApi", () => ({ fetchSettings }));

function Probe() {
  const {
    temperatureUnit,
    setTemperatureUnit,
    isTemperatureUnitOverridden,
    airflowUnit,
    setAirflowUnit,
    isAirflowUnitOverridden,
  } = useDisplayUnit();
  return (
    <div>
      <span data-testid="temp">{temperatureUnit}</span>
      <span data-testid="tempOverridden">
        {String(isTemperatureUnitOverridden)}
      </span>
      <span data-testid="airflow">{airflowUnit}</span>
      <span data-testid="airflowOverridden">
        {String(isAirflowUnitOverridden)}
      </span>
      <button data-testid="setC" onClick={() => setTemperatureUnit("C")}>
        set C
      </button>
      <button data-testid="clearTemp" onClick={() => setTemperatureUnit(null)}>
        clear temp
      </button>
      <button data-testid="setCFM" onClick={() => setAirflowUnit("CFM")}>
        set CFM
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <DisplayUnitProvider>
      <Probe />
    </DisplayUnitProvider>,
  );
}

describe("DisplayUnitProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    fetchSettings.mockReset().mockResolvedValue({
      control_disarmed: false,
      live_air_handler_ids: [],
      display_temperature_unit: "F",
      display_airflow_unit: "Lps",
    });
  });

  it("defaults to the hardcoded fallback before the system-settings fetch resolves", () => {
    renderProbe();
    expect(screen.getByTestId("temp")).toHaveTextContent("F");
    expect(screen.getByTestId("airflow")).toHaveTextContent("Lps");
  });

  it("adopts the fetched system default once it resolves", async () => {
    fetchSettings.mockResolvedValue({
      control_disarmed: false,
      live_air_handler_ids: [],
      display_temperature_unit: "C",
      display_airflow_unit: "CFM",
    });
    renderProbe();
    await waitFor(() => {
      expect(screen.getByTestId("temp")).toHaveTextContent("C");
      expect(screen.getByTestId("airflow")).toHaveTextContent("CFM");
    });
    expect(screen.getByTestId("tempOverridden")).toHaveTextContent("false");
  });

  it("a stored browser override wins immediately and survives the system-default fetch resolving", async () => {
    localStorage.setItem("displayTemperatureUnit", "C");
    renderProbe();
    expect(screen.getByTestId("temp")).toHaveTextContent("C");
    expect(screen.getByTestId("tempOverridden")).toHaveTextContent("true");
    await waitFor(() => expect(fetchSettings).toHaveBeenCalled());
    expect(screen.getByTestId("temp")).toHaveTextContent("C");
  });

  it("setting a unit persists it and applies immediately", () => {
    renderProbe();
    fireEvent.click(screen.getByTestId("setC"));
    expect(screen.getByTestId("temp")).toHaveTextContent("C");
    expect(localStorage.getItem("displayTemperatureUnit")).toBe("C");
  });

  it("clearing an override falls back to the system default again", async () => {
    localStorage.setItem("displayTemperatureUnit", "C");
    renderProbe();
    fireEvent.click(screen.getByTestId("clearTemp"));
    expect(screen.getByTestId("tempOverridden")).toHaveTextContent("false");
    await waitFor(() =>
      expect(screen.getByTestId("temp")).toHaveTextContent("F"),
    );
    expect(localStorage.getItem("displayTemperatureUnit")).toBeNull();
  });

  it("airflow unit behaves the same way, independently of temperature", () => {
    renderProbe();
    fireEvent.click(screen.getByTestId("setCFM"));
    expect(screen.getByTestId("airflow")).toHaveTextContent("CFM");
    expect(screen.getByTestId("temp")).toHaveTextContent("F");
    expect(localStorage.getItem("displayAirflowUnit")).toBe("CFM");
  });
});
