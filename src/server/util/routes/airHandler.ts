import AppDataSource from "~/server/database/datasource";
import { withTimestamps, touch } from "~/server/util/entityTimestamps";
import {
  resolveAirHandlerConfig,
  type AirHandlerConfig,
} from "~/shared/schemas/airHandlerConfig";

export interface AirHandlerData {
  id: string;
  installationId: string;
  flairZoneId: string | null;
  name: string;
  active: boolean;
  config: AirHandlerConfig;
}

interface AirHandlerRow {
  id: string;
  installation_id: string;
  flair_zone_id: string | null;
  name: string;
  active: boolean;
  config: unknown;
}

function toAirHandlerData(row: AirHandlerRow): AirHandlerData {
  return {
    id: row.id,
    installationId: row.installation_id,
    flairZoneId: row.flair_zone_id,
    name: row.name,
    active: row.active,
    config: resolveAirHandlerConfig(row.config),
  };
}

export async function getActiveAirHandlers(
  installationId: string,
): Promise<AirHandlerData[]> {
  const repo = (await AppDataSource.getInstance()).getRepository("AirHandler");
  const rows = (await repo.find({
    where: { installation_id: installationId, active: true },
  })) as AirHandlerRow[];
  return rows.map(toAirHandlerData);
}

export async function getAirHandlerById(
  id: string,
): Promise<AirHandlerData | null> {
  const repo = (await AppDataSource.getInstance()).getRepository("AirHandler");
  const row = (await repo.findOne({ where: { id } })) as AirHandlerRow | null;
  return row ? toAirHandlerData(row) : null;
}

export async function getAirHandlersForInstallation(
  installationId: string,
): Promise<AirHandlerData[]> {
  const repo = (await AppDataSource.getInstance()).getRepository("AirHandler");
  const rows = (await repo.find({
    where: { installation_id: installationId },
  })) as AirHandlerRow[];
  return rows.map(toAirHandlerData);
}

export async function createAirHandler(fields: {
  installationId: string;
  flairZoneId: string | null;
  name: string;
  active: boolean;
  config: AirHandlerConfig;
}): Promise<AirHandlerData> {
  const repo = (await AppDataSource.getInstance()).getRepository("AirHandler");
  const row = withTimestamps({
    installation_id: fields.installationId,
    flair_zone_id: fields.flairZoneId,
    name: fields.name,
    active: fields.active,
    config: fields.config,
  });
  await repo.insert(row);
  return toAirHandlerData(row as unknown as AirHandlerRow);
}

export async function updateAirHandler(
  id: string,
  fields: Partial<{
    flairZoneId: string | null;
    name: string;
    active: boolean;
    config: AirHandlerConfig;
  }>,
): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository("AirHandler");
  await repo.update(id, {
    ...(fields.flairZoneId !== undefined && {
      flair_zone_id: fields.flairZoneId,
    }),
    ...(fields.name !== undefined && { name: fields.name }),
    ...(fields.active !== undefined && { active: fields.active }),
    ...(fields.config !== undefined && { config: fields.config }),
    ...touch(),
  });
}

export async function deleteAirHandler(id: string): Promise<void> {
  const repo = (await AppDataSource.getInstance()).getRepository("AirHandler");
  await repo.delete(id);
}
