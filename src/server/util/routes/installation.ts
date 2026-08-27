import AppDataSource from "~/server/database/datasource";
import { withTimestamps } from "~/server/util/entityTimestamps";

export interface InstallationData {
  id: string;
  name: string;
}

// This app runs against exactly one installation today — no multi-user/auth
// yet (see "Full authentication & multi-user support" in the plan). Creates
// the single row on first use rather than requiring a separate seed step;
// once real auth/multi-installation support lands, this is replaced by an
// actual installation-selection flow, not extended in place.
export async function getOrCreateDefaultInstallation(
  name = "Default Installation",
): Promise<InstallationData> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "Installation",
  );
  const existing = await repo.find({ take: 1 });
  if (existing.length > 0) {
    return { id: existing[0].id, name: existing[0].name };
  }
  const row = withTimestamps({ name });
  await repo.insert(row);
  return { id: row.id, name: row.name };
}
