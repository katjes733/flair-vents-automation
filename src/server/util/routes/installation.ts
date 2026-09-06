import AppDataSource from "~/server/database/datasource";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";

export interface InstallationData {
  id: string;
  name: string;
  flairStructureId: string | null;
  isActive: boolean;
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
    return {
      id: existing[0].id,
      name: existing[0].name,
      flairStructureId: existing[0].flair_structure_id,
      isActive: existing[0].is_active,
    };
  }
  const row = withTimestamps({
    name,
    flair_structure_id: null,
    is_active: true,
  });
  await repo.insert(row);
  return { id: row.id, name: row.name, flairStructureId: null, isActive: true };
}

// Every installation the control loop should actually tick — filters out
// one still missing a linked Flair structure (a stale pre-auth row, or a
// signup that never finished connecting Flair) or explicitly deactivated,
// the same gate every caller previously had to apply itself against a
// single hardcoded installation. This is what BullMQ's job-scheduler
// reconciliation (queue.ts's reconcileInstallationSchedulers) diffs
// against — see the SaaS Transformation plan's "Horizontal Scaling"
// section.
export async function getActiveInstallations(): Promise<InstallationData[]> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "Installation",
  );
  const rows = await repo.find();
  return rows
    .filter((row) => row.is_active && row.flair_structure_id)
    .map((row) => ({
      id: row.id,
      name: row.name,
      flairStructureId: row.flair_structure_id,
      isActive: row.is_active,
    }));
}

export async function getInstallationById(
  id: string,
): Promise<InstallationData | null> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "Installation",
  );
  const row = await repo.findOneBy({ id });
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    flairStructureId: row.flair_structure_id,
    isActive: row.is_active,
  };
}

export async function setInstallationFlairStructureId(
  installationId: string,
  flairStructureId: string,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository(
    "Installation",
  );
  await repo.update(installationId, {
    flair_structure_id: flairStructureId,
    ...touch(),
  });
}
