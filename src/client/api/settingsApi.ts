import { httpClient } from "~/client/api/httpClient";

// A deliberately loose shape — the dashboard only ever reads a handful of
// these fields today (control_disarmed for the GlobalStatusBar), and the
// full system_settings config has dozens of tunables that belong to
// Phase 2's SystemParameters page, not here.
export interface SystemSettings {
  control_disarmed: boolean;
  live_air_handler_ids: string[];
  [key: string]: unknown;
}

export async function fetchSettings(): Promise<SystemSettings> {
  const { data } = await httpClient.get<SystemSettings>("/settings");
  return data;
}
