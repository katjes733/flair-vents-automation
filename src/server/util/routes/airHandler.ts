import AppDataSource from "~/server/database/datasource";
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
