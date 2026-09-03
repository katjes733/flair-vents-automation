import AppDataSource from "~/server/database/datasource";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";
import {
  resolveSystemSettings,
  type SystemSettingsConfig,
} from "~/shared/schemas/systemSettings";

export async function getSystemSettings(
  installationId: string,
): Promise<SystemSettingsConfig> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "SystemSettings",
  );
  const row = await repo.findOne({
    where: { installation_id: installationId },
  });
  return resolveSystemSettings((row as { config?: unknown } | null)?.config);
}

/**
 * Upsert — no seed step creates this row on installation creation, so the
 * first-ever settings write for an installation has no existing row to
 * update. `installation_id UNIQUE NOT NULL` (see Data Model /
 * Multi-tenancy) is what makes "at most one row" a DB guarantee either way.
 */
export async function updateSystemSettings(
  installationId: string,
  config: SystemSettingsConfig,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "SystemSettings",
  );
  const existing = await repo.findOne({
    where: { installation_id: installationId },
  });
  if (existing) {
    await repo.update((existing as { id: string }).id, {
      config,
      ...touch(),
    });
  } else {
    await repo.insert(
      withTimestamps({ installation_id: installationId, config }),
    );
  }
}
