import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DisplayUnitContext } from "~/client/theme/displayUnitContextValue";
import { fetchSettings } from "~/client/api/settingsApi";
import type { TemperatureUnit } from "~/shared/types/temperature";
import type { AirflowUnit } from "~/shared/types/airflow";

const TEMPERATURE_STORAGE_KEY = "displayTemperatureUnit";
const AIRFLOW_STORAGE_KEY = "displayAirflowUnit";

// Same three-file shape as ThemeModeProvider/DiagnosticModeProvider, but
// with a third resolution tier neither of those needs: an explicit
// per-browser localStorage choice wins immediately (no flash of a
// different unit while a fetch is in flight); absent that, the
// system-wide default (system_settings.config.display_temperature_unit /
// display_airflow_unit) applies once fetched; absent even a reachable
// server, a hardcoded fallback ("F"/"Lps") keeps the app usable. See
// "Temperature units" / the Settings page section of the implementation
// plan.
function resolveStoredTemperatureUnit(): TemperatureUnit | null {
  try {
    const saved = localStorage.getItem(TEMPERATURE_STORAGE_KEY);
    if (saved === "C" || saved === "F") return saved;
  } catch {
    // localStorage unavailable (e.g. private browsing restrictions)
  }
  return null;
}

function resolveStoredAirflowUnit(): AirflowUnit | null {
  try {
    const saved = localStorage.getItem(AIRFLOW_STORAGE_KEY);
    if (saved === "Lps" || saved === "CFM" || saved === "M3h") return saved;
  } catch {
    // localStorage unavailable
  }
  return null;
}

export function DisplayUnitProvider({ children }: { children: ReactNode }) {
  const [storedTemperatureUnit, setStoredTemperatureUnit] =
    useState<TemperatureUnit | null>(resolveStoredTemperatureUnit);
  const [storedAirflowUnit, setStoredAirflowUnit] =
    useState<AirflowUnit | null>(resolveStoredAirflowUnit);
  const [systemTemperatureUnit, setSystemTemperatureUnit] =
    useState<TemperatureUnit>("F");
  const [systemAirflowUnit, setSystemAirflowUnit] =
    useState<AirflowUnit>("Lps");

  // Always fetched, even when a browser override already exists — the
  // "use system default" action (Settings page) needs a real value to
  // fall back to, and this is one cheap GET per app load, already fetched
  // elsewhere (GlobalStatusBar) via the same endpoint.
  useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((settings) => {
        if (cancelled) return;
        setSystemTemperatureUnit(settings.display_temperature_unit);
        setSystemAirflowUnit(settings.display_airflow_unit);
      })
      .catch(() => {
        // System default unreachable — keep the hardcoded fallback. A
        // browser override, if any, is unaffected either way.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setTemperatureUnit = useCallback((unit: TemperatureUnit | null) => {
    setStoredTemperatureUnit(unit);
    try {
      if (unit) localStorage.setItem(TEMPERATURE_STORAGE_KEY, unit);
      else localStorage.removeItem(TEMPERATURE_STORAGE_KEY);
    } catch {
      // ignore — the choice still applies for the current session
    }
  }, []);

  const setAirflowUnit = useCallback((unit: AirflowUnit | null) => {
    setStoredAirflowUnit(unit);
    try {
      if (unit) localStorage.setItem(AIRFLOW_STORAGE_KEY, unit);
      else localStorage.removeItem(AIRFLOW_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const value = useMemo(
    () => ({
      temperatureUnit: storedTemperatureUnit ?? systemTemperatureUnit,
      setTemperatureUnit,
      isTemperatureUnitOverridden: storedTemperatureUnit !== null,
      airflowUnit: storedAirflowUnit ?? systemAirflowUnit,
      setAirflowUnit,
      isAirflowUnitOverridden: storedAirflowUnit !== null,
    }),
    [
      storedTemperatureUnit,
      systemTemperatureUnit,
      setTemperatureUnit,
      storedAirflowUnit,
      systemAirflowUnit,
      setAirflowUnit,
    ],
  );

  return (
    <DisplayUnitContext.Provider value={value}>
      {children}
    </DisplayUnitContext.Provider>
  );
}
