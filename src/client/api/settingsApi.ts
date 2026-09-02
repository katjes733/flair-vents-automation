import { httpClient } from "~/client/api/httpClient";
import type { TemperatureUnit } from "~/shared/types/temperature";
import type { AirflowUnit } from "~/shared/types/airflow";

// A deliberately loose shape — the dashboard only ever reads a handful of
// these fields today (control_disarmed for the GlobalStatusBar,
// display_temperature_unit/display_airflow_unit for the Settings page's
// system-default tier), and the full system_settings config has dozens of
// tunables that belong to Phase 2's SystemParameters page, not here.
export interface SystemSettings {
  control_disarmed: boolean;
  live_air_handler_ids: string[];
  display_temperature_unit: TemperatureUnit;
  display_airflow_unit: AirflowUnit;
  [key: string]: unknown;
}

export async function fetchSettings(): Promise<SystemSettings> {
  const { data } = await httpClient.get<SystemSettings>("/settings");
  return data;
}

// A partial patch — same shape the server's own systemSettingsConfigPartialSchema
// accepts. Only send the fields actually changing; see that schema's own
// comment for why a fully-populated body must never be assumed safe to omit.
export async function updateSettings(
  patch: Partial<SystemSettings>,
): Promise<SystemSettings> {
  const { data } = await httpClient.patch<{ config: SystemSettings }>(
    "/settings",
    patch,
  );
  return data.config;
}
