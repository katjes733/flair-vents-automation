import { createContext } from "react";
import type { TemperatureUnit } from "~/shared/types/temperature";
import type { AirflowUnit } from "~/shared/types/airflow";

export interface DisplayUnitContextValue {
  temperatureUnit: TemperatureUnit;
  // Pass null to clear the browser override and fall back to the system
  // default again.
  setTemperatureUnit: (unit: TemperatureUnit | null) => void;
  isTemperatureUnitOverridden: boolean;
  airflowUnit: AirflowUnit;
  setAirflowUnit: (unit: AirflowUnit | null) => void;
  isAirflowUnitOverridden: boolean;
}

// Deliberately Celsius/L-s here — a plain passthrough — rather than the
// app's actual "F" system default. This value is only ever seen by a
// component rendered with no <DisplayUnitProvider> above it (every real
// page always has one, mounted in App.tsx), which in practice means only
// component tests that don't care about unit conversion — keeping this a
// no-op conversion is what lets every existing test asserting a raw
// Celsius/L-s value keep passing unmodified, rather than every one of them
// needing to wrap in a provider or account for an F conversion it isn't
// testing.
export const DisplayUnitContext = createContext<DisplayUnitContextValue>({
  temperatureUnit: "C",
  setTemperatureUnit: () => {},
  isTemperatureUnitOverridden: false,
  airflowUnit: "Lps",
  setAirflowUnit: () => {},
  isAirflowUnitOverridden: false,
});
