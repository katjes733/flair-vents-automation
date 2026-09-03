import { httpClient } from "~/client/api/httpClient";
import type { SystemSettingsConfig } from "~/shared/schemas/systemSettings";

// The real, full config shape (type-only import — erased at build time, so
// this doesn't pull the zod schema itself into the client bundle here).
// Sharing the server's own inferred type means every one of the ~45 tunables
// the System Parameters page edits stays in sync with the server schema by
// construction, rather than a hand-duplicated, driftable field list.
export type SystemSettings = SystemSettingsConfig & {
  // The real, live value of the global DRY_RUN env var — read-only,
  // never itself part of system_settings.config (see routes/settings.ts's
  // own comment for why). Deliberately excluded from `updateSettings`'s
  // patch type below; sending it in a PATCH would be silently ignored
  // server-side either way, but the type shouldn't invite it.
  dry_run: boolean;
};

export async function fetchSettings(): Promise<SystemSettings> {
  const { data } = await httpClient.get<SystemSettings>("/settings");
  return data;
}

export interface SettingsUpdateResult {
  // The PATCH response only ever echoes the real DB-backed config — never
  // `dry_run`, which is env-only and only ever appended by the GET route.
  config: SystemSettingsConfig;
  warnings: string[];
}

// A partial patch — same shape the server's own systemSettingsConfigPartialSchema
// accepts. Only send the fields actually changing; see that schema's own
// comment for why a fully-populated body must never be assumed safe to omit.
// `warnings` surfaces the server's own named config-relationship checks
// (e.g. min_step_delta_pct vs. modulation_step_pct) — real to know about,
// but never blocking, per updateSettingsForInstallation's own contract.
export async function updateSettings(
  patch: Partial<SystemSettingsConfig>,
): Promise<SettingsUpdateResult> {
  const { data } = await httpClient.patch<SettingsUpdateResult>(
    "/settings",
    patch,
  );
  return data;
}
