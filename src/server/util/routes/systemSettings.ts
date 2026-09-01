import AppDataSource from "~/server/database/datasource";
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
