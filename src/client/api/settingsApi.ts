import { httpClient } from "~/client/api/httpClient";
import type { SystemSettingsConfig } from "~/shared/schemas/systemSettings";

// The real, full config shape (type-only import — erased at build time, so
// this doesn't pull the zod schema itself into the client bundle here).
// Sharing the server's own inferred type means every one of the ~45 tunables
// the System Parameters page edits stays in sync with the server schema by
// construction, rather than a hand-duplicated, driftable field list.
export type SystemSettings = SystemSettingsConfig;

export async function fetchSettings(): Promise<SystemSettings> {
  const { data } = await httpClient.get<SystemSettings>("/settings");
  return data;
}

export interface SettingsUpdateResult {
  config: SystemSettings;
  warnings: string[];
}

// A partial patch — same shape the server's own systemSettingsConfigPartialSchema
// accepts. Only send the fields actually changing; see that schema's own
// comment for why a fully-populated body must never be assumed safe to omit.
// `warnings` surfaces the server's own named config-relationship checks
// (e.g. min_step_delta_pct vs. modulation_step_pct) — real to know about,
// but never blocking, per updateSettingsForInstallation's own contract.
export async function updateSettings(
  patch: Partial<SystemSettings>,
): Promise<SettingsUpdateResult> {
  const { data } = await httpClient.patch<SettingsUpdateResult>(
    "/settings",
    patch,
  );
  return data;
}
